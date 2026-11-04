// A reusable Verlet rope for p5.js.
// Include this file before your sketch, then:
//
//   let rope = new Rope(200, 20, { length: 300, segments: 15 });
//
//   function draw() {
//     rope.update();
//     rope.draw();
//   }
//
// The first point is pinned where you create the rope. You can pin, move and
// release any point, and push the rope around with the mouse or a fingertip.

class Rope {
  constructor(x, y, options = {}) {
    // Shape
    this.segments = options.segments ?? 10;    // number of sticks (more = smoother but slower)
    this.length = options.length ?? 200;       // total length in pixels

    // Physics
    this.gravity = options.gravity ?? 0.5;
    this.damping = options.damping ?? 0.99;    // 1 = swings forever, lower = settles faster
    this.stiffness = options.stiffness ?? 5;   // passes of stick fixing per frame (more = less stretchy)

    // Looks
    this.color = options.color ?? 0;
    this.thickness = options.thickness ?? 4;
    this.showPoints = options.showPoints ?? false;

    // Make the points in a line hanging straight down from (x, y)
    this.points = [];
    for (let i = 0; i <= this.segments; i++) {
      let py = y + i * this.segLen;
      // x, y = where it is now. px, py = where it was last frame.
      this.points.push({ x: x, y: py, px: x, py: py, pinned: false });
    }

    this.pin(0);
  }

  // Length of each stick
  get segLen() {
    return this.length / this.segments;
  }

  get start() {
    return this.points[0];
  }

  get end() {
    return this.points[this.points.length - 1];
  }

  // --- Pinning ---------------------------------------------------------------

  // Hold a point still. Pass x, y to also move it there.
  // Negative indexes count from the end: pin(-1) pins the last point.
  pin(index, x, y) {
    let p = this.points.at(index);
    p.pinned = true;
    if (x !== undefined) {
      p.x = p.px = x;
      p.y = p.py = y;
    }
  }

  // Let a point move freely again
  unpin(index) {
    this.points.at(index).pinned = false;
  }

  // Shortcuts for the two ends
  pinStart(x, y) { this.pin(0, x, y); }
  pinEnd(x, y)   { this.pin(-1, x, y); }
  unpinStart()   { this.unpin(0); }
  unpinEnd()     { this.unpin(-1); }

  // --- Forces ----------------------------------------------------------------

  // Drag nearby points along with something moving through the rope, like the
  // mouse or a fingertip. (x, y) is where it is, (vx, vy) is how far it moved
  // this frame. Points closer to it get pushed harder.
  push(x, y, vx, vy, radius = 100, strength = 0.5) {
    for (let p of this.points) {
      if (p.pinned) continue;
      let d = dist(p.x, p.y, x, y);
      if (d < radius) {
        let k = (1 - d / radius) * strength;
        p.x += vx * k;
        p.y += vy * k;
      }
    }
  }

  // --- Simulation ------------------------------------------------------------

  update() {
    // 1. Move every free point: keep its speed, and add gravity
    for (let p of this.points) {
      if (p.pinned) continue;
      let vx = (p.x - p.px) * this.damping;
      let vy = (p.y - p.py) * this.damping;
      p.px = p.x;
      p.py = p.y;
      p.x += vx;
      p.y += vy + this.gravity;
    }

    // 2. Fix the sticks. Doing it a few times makes the rope less stretchy.
    for (let n = 0; n < this.stiffness; n++) {
      this.fixShape();
    }
  }

  // Pull each pair of neighbours back to the right distance.
  // Pinned points don't move, so their free neighbour takes the whole correction.
  fixShape() {
    let segLen = this.segLen;
    for (let i = 0; i < this.points.length - 1; i++) {
      let a = this.points[i];
      let b = this.points[i + 1];
      if (a.pinned && b.pinned) continue;

      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let d = max(sqrt(dx * dx + dy * dy), 0.001);
      let error = (d - segLen) / d;

      let aShare = a.pinned ? 0 : b.pinned ? 1 : 0.5;
      let bShare = 1 - aShare;
      a.x += dx * error * aShare;
      a.y += dy * error * aShare;
      b.x -= dx * error * bShare;
      b.y -= dy * error * bShare;
    }
  }

  // --- Drawing ---------------------------------------------------------------

  draw() {
    push();
    noFill();
    stroke(this.color);
    strokeWeight(this.thickness);
    beginShape();
    for (let p of this.points) splineVertex(p.x, p.y);
    endShape();

    if (this.showPoints) {
      noStroke();
      fill(255, 100, 100);
      for (let p of this.points) circle(p.x, p.y, this.thickness * 2.5);
    }
    pop();
  }
}
