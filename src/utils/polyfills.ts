/**
 * Polyfills for pdf-parse (pdfjs-dist) in Node.js environments
 * specifically for Single Executable Application (SEA) bundles.
 */

const globals = globalThis as any;

// Mock DOMMatrix
if (!globals.DOMMatrix) {
  globals.DOMMatrix = class DOMMatrix {
    constructor() {}
    static fromFloat32Array() {
      return new DOMMatrix();
    }
    static fromFloat64Array() {
      return new DOMMatrix();
    }
    static fromMatrix() {
      return new DOMMatrix();
    }
    multiply() {
      return this;
    }
    scale() {
      return this;
    }
    translate() {
      return this;
    }
    inverse() {
      return this;
    }
    rotate() {
      return this;
    }
  };
}

// Mock ImageData
if (!globals.ImageData) {
  globals.ImageData = class ImageData {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
      this.data = new Uint8ClampedArray(width * height * 4);
    }
  };
}

// Mock Path2D
if (!globals.Path2D) {
  globals.Path2D = class Path2D {
    constructor() {}
    addPath() {}
    closePath() {}
    moveTo() {}
    lineTo() {}
    bezierCurveTo() {}
    quadraticCurveTo() {}
    arc() {}
    arcTo() {}
    ellipse() {}
    rect() {}
  };
}

console.log('[POLYFILL] Entorno Node.js con soporte para Canvas/PDF APIs.');
