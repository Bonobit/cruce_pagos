// Mocking @napi-rs/canvas for text-only PDF parsing in SEA environments
export const createCanvas = () => ({
  getContext: () => ({
    measureText: () => ({ width: 0 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fill: () => {},
    closePath: () => {},
    setTransform: () => {},
    drawImage: () => {},
    save: () => {},
    restore: () => {},
    createImageData: () => ({ data: new Uint8ClampedArray(0) }),
    putImageData: () => {},
  }),
  toBuffer: () => Buffer.from([]),
});

export const Image = class {};
export const GlobalWorkerOptions = {};
