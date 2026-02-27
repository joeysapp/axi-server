## Features
- Migrate the legacy frontend polling behavior for /queue and /path to be communicated over WebSocket messaging
- Extend the knowledge around the AxiDraw physical state using new functions for EBB serial query commands. Store and expose the new information via both REST and WebSocket messages. Add a new SERIAL STATE section on the frontend that this new information using the live WS connection. Design the use of these queries intelligently knowing there are other serial commands; 
  - Query Step command ('QS', ./ROADMAP-PLUGINS/EggBot-ebb.mdL1335:1357)
    - NOTE: This fact seems extremely valuable and should inform how we use these commands:_
The global step positions can be be queried even while the motors are stepping, and it will be_ accurate the instant that the query is executed__
  - Query Utility - Maintaining knowledge of Axi's own fifo/expected state and its health
  - The goal of slowly building out logic around low-level serial commands: maintaining the Axi's logical state vs. our state for the Axi vs. the actual physical state - a complex task that involves active querying, care on boot/shutdown/reset/reboot, confirming/asserting values and handling all possible scenarios. This is legitimately difficult and powerful feature to implement; make plans and document in README (update) the roadmap for this ordered by priority/importance to handle. Extremely common example: The AxiDraw is at 100,100. We reboot or reset it. The AxiDraw believes it is at 0,0 and cannot go back to its physical home.
  - Motors On/Off - Manual Motor Commands - Provide over REST,WS and as buttons/mantine components in SERIAL area
- New SVG upload behavior:
  When a user uploads an SVG, it is added to the SVG Queue _but does not start._
  The SVG is now projected onto the canvas (to all connected WS clients via path/svg/planned-path message), in an opaque glowing path (Three.js) of where the SVG is planned to be plotted.
  If the user accepts/clicks plot (either in queue or a button/state/control on top of canvas), the job is procedes and the AxiDraw prints with the path being added and sent over WS for display as normal. If the user clicks to remove, it is removed from the queue and the planned path is removed for all client canvases.
  - Implementation suggestion - use the Queue itself for this functionality such that all path/items in the queue are projected in a communicative manner so it is clear where the AxiDraw is _going_ to plot. Better yet have each item in the queue be a separate/progressive color so order is clear too.
  - Implementation: `
### SVG Interaction
Using `three/addons/loaders/SVGLoader.js`:
1. **Loading**: Convert uploaded SVGs into `THREE.Shape` objects.
2. **Rendering**: Draw shapes as `THREE.Mesh` or `THREE.Line` in the 3D canvas.
3. **Manipulation**: Use `three/addons/controls/TransformControls.js` (to be added) to allow dragging, rotating, and scaling the SVG "paths" before they are sent to the queue.
`
## UI
- Update 'AXI-VIZ'/active header to show statuses of server and axidraw connections, removing above component
- Change AXI-VIZ to axi-lab and remove top header, expand 3D view to use regained space
- Update the 3D view to fit full width of viewport
## Bugs
- Path is not displayed to connected client over websocket - it requires refreshing the page to see the new path
- Pen state is not handled correctly:
```
# Pen is in a down state on the frontend, toggle button is pressed.
# What happens on the frontend: pen goes up, says 'up', then goes right back down. Logs:
{ type: 'event', action: 'pen_toggle' }
[AxiDraw] State: ready -> busy
[Servo] penUp: SP,1,59,2
[AxiDraw] State: busy -> ready
...
# Pressing again, same exact as above happens:
{ type: 'event', action: 'pen_toggle' }
[AxiDraw] State: ready -> busy
[Servo] penUp: SP,1,59,2
[AxiDraw] State: busy -> ready
```
  - Implementation suggestion: Figure out why this happens before fixing it. Shouldn't the pen_toggle command work regardless of our own spatial state tracking? Look below at EggBot-ebb.md suggestions; perhaps some existing commands could benefit from some thoughtful usage of additional serial commands (e.g. low-level, undocumented behaviors we could design ourselves with system design and even predictive algorithms.)
	- Reference: backend/api/websocket.js - many comments surrounding our commands and messages and how physical<->logical<->client(s) can get desync so easily.
