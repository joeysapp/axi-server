/**
	* SVG Parser Module
	*
	* Converts SVG files to AxiDraw movement commands.
	* Handles paths, basic shapes, and transformations.
	*/

import { parse as parseSvg } from 'svgson';
import svgPathParser from 'svg-path-parser';
const { parseSVG: parsePathData, makeAbsolute } = svgPathParser;

/**
	* Default SVG parsing options
	*/
const DEFAULT_OPTIONS = {
	scale: 1,
	offsetX: 0,
	offsetY: 0,
	flattenCurves: true,
	curveResolution: 0.5, // mm per segment for curve flattening
	strokesOnly: true,    // Only process stroked paths (ignore fills)
	ignoreTransforms: false
};

/**
	* SVGParser - Converts SVG to movement commands
	*/
export class SVGParser {
	constructor(options = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options };
	}

	/**
		* Parse SVG string to movement commands
		* @param {string} svgString - SVG content
		* @returns {Promise<Array>} Array of movement commands
		*/
	async parse(svgString) {
		// Parse SVG to JSON
		const svgJson = await parseSvg(svgString);

		// Extract viewBox dimensions if present
		const viewBox = this._parseViewBox(svgJson.attributes?.viewBox);
		const width = parseFloat(svgJson.attributes?.width) || viewBox?.width || 100;
		const height = parseFloat(svgJson.attributes?.height) || viewBox?.height || 100;

		this.bounds = { width, height, viewBox };

		// Collect all paths
		const paths = [];
		this._collectPaths(svgJson, paths, []);

		// Convert paths to commands
		const commands = [];
		for (const path of paths) {
			const pathCommands = this._pathToCommands(path);
			commands.push(...pathCommands);
		}

		// Add final pen up
		if (commands.length > 0 &&
			commands[commands.length - 1].type !== 'penUp') {
			commands.push({ type: 'penUp' });
		}

		return commands;
	}

	/**
		* Parse viewBox attribute
		*/
	_parseViewBox(viewBoxStr) {
		if (!viewBoxStr) return null;
		const parts = viewBoxStr.trim().split(/[\s,]+/).map(parseFloat);
		if (parts.length !== 4) return null;
		return {
			minX: parts[0],
			minY: parts[1],
			width: parts[2],
			height: parts[3]
		};
	}

	/**
		* Recursively collect all path data from SVG
		*/
	_collectPaths(node, paths, transforms) {
		if (!node) return;

		// Accumulate transforms
		const nodeTransforms = [...transforms];
		if (node.attributes?.transform) {
			nodeTransforms.push(this._parseTransform(node.attributes.transform));
		}

		// Handle different element types
		switch (node.name) {
			case 'path':
				if (node.attributes?.d) {
					paths.push({
						d: node.attributes.d,
						transforms: nodeTransforms,
						stroke: node.attributes?.stroke,
						fill: node.attributes?.fill
					});
				}
				break;

			case 'line':
				paths.push({
					d: this._lineToPath(node.attributes),
					transforms: nodeTransforms,
					stroke: node.attributes?.stroke
				});
				break;

			case 'rect':
				paths.push({
					d: this._rectToPath(node.attributes),
					transforms: nodeTransforms,
					stroke: node.attributes?.stroke,
					fill: node.attributes?.fill
				});
				break;

			case 'circle':
				paths.push({
					d: this._circleToPath(node.attributes),
					transforms: nodeTransforms,
					stroke: node.attributes?.stroke,
					fill: node.attributes?.fill
				});
				break;

			case 'ellipse':
				paths.push({
					d: this._ellipseToPath(node.attributes),
					transforms: nodeTransforms,
					stroke: node.attributes?.stroke,
					fill: node.attributes?.fill
				});
				break;

			case 'polygon':
				paths.push({
					d: this._polygonToPath(node.attributes, true),
					transforms: nodeTransforms,
					stroke: node.attributes?.stroke,
					fill: node.attributes?.fill
				});
				break;

			case 'polyline':
				paths.push({
					d: this._polygonToPath(node.attributes, false),
					transforms: nodeTransforms,
					stroke: node.attributes?.stroke
				});
				break;
		}

		// Process children
		if (node.children) {
			for (const child of node.children) {
				this._collectPaths(child, paths, nodeTransforms);
			}
		}
	}

	/**
		* Convert line element to path
		*/
	_lineToPath(attrs) {
		const x1 = parseFloat(attrs.x1) || 0;
		const y1 = parseFloat(attrs.y1) || 0;
		const x2 = parseFloat(attrs.x2) || 0;
		const y2 = parseFloat(attrs.y2) || 0;
		return `M${x1},${y1}L${x2},${y2}`;
	}

	/**
		* Convert rect element to path
		*/
	_rectToPath(attrs) {
		const x = parseFloat(attrs.x) || 0;
		const y = parseFloat(attrs.y) || 0;
		const w = parseFloat(attrs.width) || 0;
		const h = parseFloat(attrs.height) || 0;
		return `M${x},${y}L${x + w},${y}L${x + w},${y + h}L${x},${y + h}Z`;
	}

	/**
		* Convert circle to path (approximation using bezier curves)
		*/
	_circleToPath(attrs) {
		const cx = parseFloat(attrs.cx) || 0;
		const cy = parseFloat(attrs.cy) || 0;
		const r = parseFloat(attrs.r) || 0;
		return this._ellipseToPath({ cx, cy, rx: r, ry: r });
	}

	/**
		* Convert ellipse to path
		*/
	_ellipseToPath(attrs) {
		const cx = parseFloat(attrs.cx) || 0;
		const cy = parseFloat(attrs.cy) || 0;
		const rx = parseFloat(attrs.rx) || 0;
		const ry = parseFloat(attrs.ry) || 0;

		// Use bezier approximation (4 arcs with control point factor ~0.5523)
		const k = 0.5523;
		const kx = rx * k;
		const ky = ry * k;

		return `M${cx - rx},${cy}` +
			`C${cx - rx},${cy - ky} ${cx - kx},${cy - ry} ${cx},${cy - ry}` +
			`C${cx + kx},${cy - ry} ${cx + rx},${cy - ky} ${cx + rx},${cy}` +
			`C${cx + rx},${cy + ky} ${cx + kx},${cy + ry} ${cx},${cy + ry}` +
			`C${cx - kx},${cy + ry} ${cx - rx},${cy + ky} ${cx - rx},${cy}Z`;
	}

	/**
		* Convert polygon/polyline to path
		*/
	_polygonToPath(attrs, close) {
		const points = (attrs.points || '').trim().split(/[\s,]+/);
		if (points.length < 2) return '';

		let d = '';
		for (let i = 0; i < points.length; i += 2) {
			const x = parseFloat(points[i]) || 0;
			const y = parseFloat(points[i + 1]) || 0;
			d += (i === 0 ? 'M' : 'L') + x + ',' + y;
		}

		if (close) d += 'Z';
		return d;
	}

	/**
		* Parse transform attribute
		*/
	_parseTransform(transformStr) {
		const transforms = [];
		const regex = /(\w+)\(([^)]+)\)/g;
		let match;

		while ((match = regex.exec(transformStr)) !== null) {
			const type = match[1];
			const values = match[2].split(/[\s,]+/).map(parseFloat);

			switch (type) {
				case 'translate':
					transforms.push({
						type: 'translate',
						x: values[0] || 0,
						y: values[1] || 0
					});
					break;
				case 'scale':
					transforms.push({
						type: 'scale',
						x: values[0] || 1,
						y: values[1] ?? values[0] ?? 1
					});
					break;
				case 'rotate':
					transforms.push({
						type: 'rotate',
						angle: values[0] || 0,
						cx: values[1] || 0,
						cy: values[2] || 0
					});
					break;
				case 'matrix':
					transforms.push({
						type: 'matrix',
						a: values[0] || 1, b: values[1] || 0,
						c: values[2] || 0, d: values[3] || 1,
						e: values[4] || 0, f: values[5] || 0
					});
					break;
			}
		}

		return transforms;
	}

	/**
		* Apply transforms to a point
		*/
	_applyTransforms(x, y, transforms) {
		if (this.options.ignoreTransforms) {
			return { x, y };
		}

		for (const transformGroup of transforms) {
			for (const t of transformGroup) {
				switch (t.type) {
					case 'translate':
						x += t.x;
						y += t.y;
						break;
					case 'scale':
						x *= t.x;
						y *= t.y;
						break;
					case 'rotate':
						const radians = (t.angle * Math.PI) / 180;
						const cos = Math.cos(radians);
						const sin = Math.sin(radians);
						const rx = x - t.cx;
						const ry = y - t.cy;
						x = rx * cos - ry * sin + t.cx;
						y = rx * sin + ry * cos + t.cy;
						break;
					case 'matrix':
						const nx = t.a * x + t.c * y + t.e;
						const ny = t.b * x + t.d * y + t.f;
						x = nx;
						y = ny;
						break;
				}
			}
		}

		// Apply global scale and offset
		x = x * this.options.scale + this.options.offsetX;
		y = y * this.options.scale + this.options.offsetY;

		return { x, y };
	}

	/**
		* Convert parsed path to movement commands
		* IMPORTANT: Uses lineTo (relative deltas) for pen-down moves, moveTo (absolute) for pen-up
		*/
	_pathToCommands(pathObj) {
		const commands = [];
		const { d, transforms, stroke, fill } = pathObj;

		// Skip if no stroke and strokesOnly option is set
		if (this.options.strokesOnly && stroke === 'none' && !fill) {
			return commands;
		}

		// Parse path data
		let pathCommands;
		try {
			pathCommands = makeAbsolute(parsePathData(d));
		} catch (e) {
			console.warn('Failed to parse path:', d.substring(0, 50));
			return commands;
		}

		let currentX = 0;
		let currentY = 0;
		let pathStartX = 0;
		let pathStartY = 0;
		let penDown = false;

		// Track transformed position for calculating relative deltas
		let lastTransformedX = 0;
		let lastTransformedY = 0;

		for (const cmd of pathCommands) {
			switch (cmd.code) {
				case 'M': // Move to
					// Pen up, move to new position
					if (penDown) {
						commands.push({ type: 'penUp' });
						penDown = false;
					}
					{
						const p = this._applyTransforms(cmd.x, cmd.y, transforms);
						commands.push({ type: 'moveTo', x: p.x, y: p.y, units: 'mm' });
						currentX = cmd.x;
						currentY = cmd.y;
						pathStartX = currentX;
						pathStartY = currentY;
						lastTransformedX = p.x;
						lastTransformedY = p.y;
					}
					break;

				case 'L': // Line to
					if (!penDown) {
						commands.push({ type: 'penDown' });
						penDown = true;
					}
					{
						const p = this._applyTransforms(cmd.x, cmd.y, transforms);
						// Use lineTo with relative deltas (pen stays down)
						const dx = p.x - lastTransformedX;
						const dy = p.y - lastTransformedY;
						commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
						currentX = cmd.x;
						currentY = cmd.y;
						lastTransformedX = p.x;
						lastTransformedY = p.y;
					}
					break;

				case 'H': // Horizontal line
					if (!penDown) {
						commands.push({ type: 'penDown' });
						penDown = true;
					}
					{
						const p = this._applyTransforms(cmd.x, currentY, transforms);
						const dx = p.x - lastTransformedX;
						const dy = p.y - lastTransformedY;
						commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
						currentX = cmd.x;
						lastTransformedX = p.x;
						lastTransformedY = p.y;
					}
					break;

				case 'V': // Vertical line
					if (!penDown) {
						commands.push({ type: 'penDown' });
						penDown = true;
					}
					{
						const p = this._applyTransforms(currentX, cmd.y, transforms);
						const dx = p.x - lastTransformedX;
						const dy = p.y - lastTransformedY;
						commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
						currentY = cmd.y;
						lastTransformedX = p.x;
						lastTransformedY = p.y;
					}
					break;

				case 'C': // Cubic bezier
					if (!penDown) {
						commands.push({ type: 'penDown' });
						penDown = true;
					}
					{
						const points = this._flattenCubicBezier(
							currentX, currentY,
							cmd.x1, cmd.y1,
							cmd.x2, cmd.y2,
							cmd.x, cmd.y
						);
						for (const pt of points) {
							const p = this._applyTransforms(pt.x, pt.y, transforms);
							const dx = p.x - lastTransformedX;
							const dy = p.y - lastTransformedY;
							commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
							lastTransformedX = p.x;
							lastTransformedY = p.y;
						}
						currentX = cmd.x;
						currentY = cmd.y;
					}
					break;

				case 'Q': // Quadratic bezier
					if (!penDown) {
						commands.push({ type: 'penDown' });
						penDown = true;
					}
					{
						const points = this._flattenQuadraticBezier(
							currentX, currentY,
							cmd.x1, cmd.y1,
							cmd.x, cmd.y
						);
						for (const pt of points) {
							const p = this._applyTransforms(pt.x, pt.y, transforms);
							const dx = p.x - lastTransformedX;
							const dy = p.y - lastTransformedY;
							commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
							lastTransformedX = p.x;
							lastTransformedY = p.y;
						}
						currentX = cmd.x;
						currentY = cmd.y;
					}
					break;

				case 'A': // Arc
					if (!penDown) {
						commands.push({ type: 'penDown' });
						penDown = true;
					}
					{
						const points = this._flattenArc(
							currentX, currentY,
							cmd.rx, cmd.ry,
							cmd.xAxisRotation,
							cmd.largeArc,
							cmd.sweep,
							cmd.x, cmd.y
						);
						for (const pt of points) {
							const p = this._applyTransforms(pt.x, pt.y, transforms);
							const dx = p.x - lastTransformedX;
							const dy = p.y - lastTransformedY;
							commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
							lastTransformedX = p.x;
							lastTransformedY = p.y;
						}
						currentX = cmd.x;
						currentY = cmd.y;
					}
					break;

				case 'Z': // Close path
				case 'z':
					if (currentX !== pathStartX || currentY !== pathStartY) {
						if (!penDown) {
							commands.push({ type: 'penDown' });
							penDown = true;
						}
						const p = this._applyTransforms(pathStartX, pathStartY, transforms);
						const dx = p.x - lastTransformedX;
						const dy = p.y - lastTransformedY;
						commands.push({ type: 'lineTo', dx, dy, units: 'mm' });
						currentX = pathStartX;
						currentY = pathStartY;
						lastTransformedX = p.x;
						lastTransformedY = p.y;
					}
					break;
			}
		}

		if (penDown) {
			commands.push({ type: 'penUp' });
		}

		return commands;
	}

	/**
		* Flatten cubic bezier curve to line segments
		*/
	_flattenCubicBezier(x0, y0, x1, y1, x2, y2, x3, y3) {
		const points = [];
		const res = this.options.curveResolution;

		// Estimate length for number of segments
		const len = Math.sqrt((x3 - x0) ** 2 + (y3 - y0) ** 2);
		const segments = Math.max(2, Math.ceil(len / res));

		for (let i = 1; i <= segments; i++) {
			const t = i / segments;
			const t2 = t * t;
			const t3 = t2 * t;
			const mt = 1 - t;
			const mt2 = mt * mt;
			const mt3 = mt2 * mt;

			const x = mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3;
			const y = mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3;

			points.push({ x, y });
		}

		return points;
	}

	/**
		* Flatten quadratic bezier curve to line segments
		*/
	_flattenQuadraticBezier(x0, y0, x1, y1, x2, y2) {
		const points = [];
		const res = this.options.curveResolution;

		const len = Math.sqrt((x2 - x0) ** 2 + (y2 - y0) ** 2);
		const segments = Math.max(2, Math.ceil(len / res));

		for (let i = 1; i <= segments; i++) {
			const t = i / segments;
			const t2 = t * t;
			const mt = 1 - t;
			const mt2 = mt * mt;

			const x = mt2 * x0 + 2 * mt * t * x1 + t2 * x2;
			const y = mt2 * y0 + 2 * mt * t * y1 + t2 * y2;

			points.push({ x, y });
		}

		return points;
	}

	/**
		* Flatten arc to line segments (simplified)
		*/
	_flattenArc(x0, y0, rx, ry, xRot, largeArc, sweep, x1, y1) {
		// Simplified arc flattening - treat as line segments
		const points = [];
		const res = this.options.curveResolution;

		// Estimate arc length roughly
		const len = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
		const segments = Math.max(2, Math.ceil(len / res));

		// Just linear interpolation for now - proper arc would need more math
		for (let i = 1; i <= segments; i++) {
			const t = i / segments;
			points.push({
				x: x0 + t * (x1 - x0),
				y: y0 + t * (y1 - y0)
			});
		}

		return points;
	}
}

export default SVGParser;
