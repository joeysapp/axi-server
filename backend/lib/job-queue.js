/**
 * Job Queue System
 *
 * Manages a queue of drawing jobs with priorities, status tracking,
 * and persistence support.
 */

import { randomUUID } from 'crypto';

/**
 * Job states
 */
export const JobState = {
  PENDING: 'pending',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Job priorities
 */
export const JobPriority = {
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  URGENT: 3
};

/**
 * Job class - represents a single queued job
 */
export class Job {
  constructor(options = {}) {
    this.id = options.id || randomUUID();
    this.type = options.type || 'commands'; // 'commands', 'svg', 'path'
    this.name = options.name || `Job ${this.id.slice(0, 8)}`;
    this.priority = options.priority ?? JobPriority.NORMAL;
    this.data = options.data || null;
    this.state = JobState.PENDING;
    this.progress = 0;
    this.error = null;

    // Timestamps
    this.createdAt = new Date().toISOString();
    this.startedAt = null;
    this.completedAt = null;

    // Metadata
    this.metadata = options.metadata || {};
  }

  /**
   * Serialize job to JSON-safe object
   */
  toJSON() {
    return {
      id: this.id,
      type: this.type,
      name: this.name,
      priority: this.priority,
      state: this.state,
      progress: this.progress,
      error: this.error,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      metadata: this.metadata,
      // Don't serialize full data for large jobs
      dataPreview: this._getDataPreview()
    };
  }

  _getDataPreview() {
    if (!this.data) return null;

    if (this.type === 'commands' && Array.isArray(this.data)) {
      return { commandCount: this.data.length };
    }

    if (this.type === 'svg') {
      return {
        svgLength: typeof this.data === 'string' ? this.data.length : null
      };
    }

    if (this.type === 'path' && Array.isArray(this.data)) {
      return { pathCount: this.data.length };
    }

    return { type: typeof this.data };
  }
}

/**
 * JobQueue - manages the queue of jobs
 */
export class JobQueue {
  constructor(options = {}) {
    this.jobs = new Map();
    this.queue = []; // Job IDs in queue order
    this.currentJob = null;
    this.isProcessing = false;
    this.isPaused = false;

    // Callbacks
    this.onJobStart = options.onJobStart || null;
    this.onJobComplete = options.onJobComplete || null;
    this.onJobFailed = options.onJobFailed || null;
    this.onJobProgress = options.onJobProgress || null;

    // Processor function - must be set by the server
    this.processor = options.processor || null;

    // History of completed jobs (limited)
    this.history = [];
    this.maxHistory = options.maxHistory || 100;
  }

  /**
   * Add a job to the queue
   * @param {Object} options - Job options
   * @returns {Job} The created job
   */
  add(options) {
    const job = new Job(options);
    this.jobs.set(job.id, job);

    // Insert into queue based on priority
    const insertIndex = this._findInsertIndex(job.priority);
    this.queue.splice(insertIndex, 0, job.id);

    // Start processing if not already
    if (!this.isProcessing && !this.isPaused) {
      this._processNext();
    }

    return job;
  }

  /**
   * Find the correct position to insert a job based on priority
   */
  _findInsertIndex(priority) {
    // Find the first job with lower priority
    for (let i = 0; i < this.queue.length; i++) {
      const job = this.jobs.get(this.queue[i]);
      if (job && job.priority < priority) {
        return i;
      }
    }
    return this.queue.length;
  }

  /**
   * Get a job by ID
   * @param {string} id - Job ID
   * @returns {Job|null}
   */
  get(id) {
    return this.jobs.get(id) || null;
  }

  /**
   * Remove a job from the queue
   * @param {string} id - Job ID
   * @returns {boolean} Success
   */
  remove(id) {
    const job = this.jobs.get(id);
    if (!job) return false;

    // Can't remove running job
    if (job.state === JobState.RUNNING) {
      return false;
    }

    // Remove from queue
    const queueIndex = this.queue.indexOf(id);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    // Mark as cancelled
    job.state = JobState.CANCELLED;
    job.completedAt = new Date().toISOString();

    // Move to history
    this._moveToHistory(job);

    return true;
  }

  /**
   * Cancel a job (including running job)
   * @param {string} id - Job ID
   * @returns {boolean} Success
   */
  async cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;

    if (job.state === JobState.RUNNING) {
      // Signal cancellation - the processor should check this
      job.state = JobState.CANCELLED;
      return true;
    }

    return this.remove(id);
  }

  /**
   * Pause queue processing
   */
  pause() {
    this.isPaused = true;
    if (this.currentJob) {
      this.currentJob.state = JobState.PAUSED;
    }
  }

  /**
   * Resume queue processing
   */
  resume() {
    this.isPaused = false;
    if (this.currentJob && this.currentJob.state === JobState.PAUSED) {
      this.currentJob.state = JobState.RUNNING;
    }
    if (!this.isProcessing) {
      this._processNext();
    }
  }

  /**
   * Clear all pending jobs
   * @returns {number} Number of jobs cleared
   */
  clear() {
    let count = 0;
    const toRemove = [];

    for (const id of this.queue) {
      const job = this.jobs.get(id);
      if (job && job.state === JobState.PENDING) {
        toRemove.push(id);
        count++;
      }
    }

    for (const id of toRemove) {
      this.remove(id);
    }

    return count;
  }

  /**
   * Get queue status
   */
  getStatus() {
    const pending = this.queue.filter(id => {
      const job = this.jobs.get(id);
      return job && job.state === JobState.PENDING;
    }).length;

    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      currentJob: this.currentJob ? this.currentJob.toJSON() : null,
      queueLength: this.queue.length,
      pendingCount: pending,
      historyCount: this.history.length
    };
  }

  /**
   * Get all jobs in queue
   */
  getQueue() {
    return this.queue.map(id => {
      const job = this.jobs.get(id);
      return job ? job.toJSON() : null;
    }).filter(j => j !== null);
  }

  /**
   * Get job history
   * @param {number} limit - Max entries to return
   */
  getHistory(limit = 50) {
    return this.history.slice(-limit);
  }

  /**
   * Update job progress
   * @param {string} id - Job ID
   * @param {number} progress - Progress (0-100)
   */
  updateProgress(id, progress) {
    const job = this.jobs.get(id);
    if (job) {
      job.progress = Math.max(0, Math.min(100, progress));
      if (this.onJobProgress) {
        this.onJobProgress(job);
      }
    }
  }

  /**
   * Move job to history
   */
  _moveToHistory(job) {
    this.jobs.delete(job.id);
    this.history.push(job.toJSON());
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  /**
   * Process the next job in queue
   */
  async _processNext() {
    if (this.isProcessing || this.isPaused || !this.processor) {
      return;
    }

    // Find next pending job
    let nextJobId = null;
    for (const id of this.queue) {
      const job = this.jobs.get(id);
      if (job && job.state === JobState.PENDING) {
        nextJobId = id;
        break;
      }
    }

    if (!nextJobId) {
      this.currentJob = null;
      return;
    }

    const job = this.jobs.get(nextJobId);
    this.currentJob = job;
    this.isProcessing = true;

    // Update job state
    job.state = JobState.RUNNING;
    job.startedAt = new Date().toISOString();

    if (this.onJobStart) {
      this.onJobStart(job);
    }

    try {
      // Run the processor
      await this.processor(job, (progress) => {
        this.updateProgress(job.id, progress);
      });

      // Check if cancelled during processing
      if (job.state === JobState.CANCELLED) {
        throw new Error('Job cancelled');
      }

      // Mark completed
      job.state = JobState.COMPLETED;
      job.progress = 100;
      job.completedAt = new Date().toISOString();

      if (this.onJobComplete) {
        this.onJobComplete(job);
      }
    } catch (err) {
      if (job.state !== JobState.CANCELLED) {
        job.state = JobState.FAILED;
        job.error = err.message;
      }
      job.completedAt = new Date().toISOString();

      if (this.onJobFailed) {
        this.onJobFailed(job, err);
      }
    }

    // Remove from queue
    const queueIndex = this.queue.indexOf(job.id);
    if (queueIndex !== -1) {
      this.queue.splice(queueIndex, 1);
    }

    // Move to history
    this._moveToHistory(job);

    // Process next
    this.isProcessing = false;
    this.currentJob = null;
    this._processNext();
  }
}

export default JobQueue;
