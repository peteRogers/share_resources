/**
 * ArduinoSerial - a small wrapper around the Web Serial API.
 *
 * Usage:
 *   const arduino = new ArduinoSerial({ baudRate: 115200 });
 *   arduino.onLine = (line) => { ... };
 *   arduino.onValue = (value) => { ... }; // fires when a line parses as a number
 *   // or just read arduino.value at any time (last parsed number, or null)
 *
 * Multiple sensors: send comma-separated numbers on one line, e.g. "512,300".
 *   arduino.onValues = (values) => { ... }; // fires with [512, 300]
 *   // or just read arduino.values at any time (last parsed numbers, or [])
 *   // arduino.value and onValue keep working and use the first number.
 *
 * Sensors with ids: send "id,value" on one line, e.g. "3,128" for sensor 3.
 *   arduino.onSensor = (id, value) => { ... }; // fires with (3, 128)
 *   // or just read arduino.sensors[3] at any time (undefined until it arrives)
 *   // Any line of two numbers counts, and the first must be a whole number 0 or above.
 *   // "3,128" also looks like two sensors, so values is [3, 128] and value is 3:
 *   // use one style or the other in a sketch, not both.
 *
 * The library manages its own "Connect to Arduino" button (shown only while
 * disconnected), a small "Disconnect" button (shown only while connected),
 * and auto-reconnects to a previously authorized device on
 * page load, so nothing else needs to be wired up in the sketch.
 */
class ArduinoSerial {
  constructor({ baudRate = 115200, autoConnect = true, buttonLabel = "Connect to Arduino" } = {}) {
    this.baudRate = baudRate;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this._readableClosed = null; // resolves once port.readable is unlocked
    this._writableClosed = null; // resolves once port.writable is unlocked
    this._buffer = "";
    this._status = "disconnected";

    this._value = null;
    this._values = [];
    this._sensors = {};

    this.onLine = null; // (line: string) => void
    this.onValue = null; // (value: number) => void, optional - fires when a line parses as a number
    this.onValues = null; // (values: number[]) => void, optional - fires when a line parses as comma-separated numbers
    this.onSensor = null; // (id: number, value: number) => void, optional - fires when a line parses as "id,value"
    this.onStatusChange = null; // (status: string) => void, optional
    this.onError = null; // (error: Error) => void, optional - defaults to console.error

    this._button = this._createButton(buttonLabel, () => this.connect());
    this._disconnectButton = this._createButton("Disconnect", () => this.disconnect());
    this._disconnectButton.style.fontSize = "11px";
    this._disconnectButton.style.display = "none";

    if (typeof navigator !== "undefined" && navigator.serial) {
      navigator.serial.addEventListener("disconnect", (event) => {
        if (event.target === this.port) this._handleDisconnect();
      });
    }

    if (autoConnect) this._tryAutoConnect();
  }

  get status() {
    return this._status;
  }

  get isConnected() {
    return this._status === "connected";
  }

  /** Last line that successfully parsed as a number, or null if none yet. */
  get value() {
    return this._value;
  }

  /** Numbers from the last line that fully parsed, e.g. [512, 300], or [] if none yet. */
  get values() {
    return this._values;
  }

  /** Latest value for each id received as "id,value", e.g. { 3: 128 }, or {} if none yet. */
  get sensors() {
    return this._sensors;
  }

  /** Prompt the user to pick a port. Must be called from a user gesture (e.g. a click). */
  async connect() {
    if (!navigator.serial) {
      this._fail(new Error("Web Serial API not supported in this browser."));
      return;
    }
    // Already connected or mid-connect (e.g. auto-connect is still opening the port).
    if (this._status !== "disconnected") return;
    try {
      const port = await navigator.serial.requestPort();
      await this._openPort(port);
    } catch (err) {
      // User cancelled the picker, or the open failed.
      this._fail(err);
    }
  }

  async disconnect() {
    await this._teardown();
    this._setStatus("disconnected");
  }

  /** Write a string to the board. No-op if not connected. */
  async send(text) {
    if (!this.writer) return;
    try {
      await this.writer.write(text);
    } catch (err) {
      this._fail(err);
    }
  }

  _createButton(label, onClick) {
    const button = document.createElement("button");
    button.textContent = label;
    button.style.position = "absolute";
    button.style.top = "10px";
    button.style.left = "10px";
    button.style.zIndex = 1000;
    button.addEventListener("click", onClick);
    document.body.appendChild(button);
    return button;
  }

  async _tryAutoConnect() {
    if (!navigator.serial || this._status !== "disconnected") return;
    try {
      const ports = await navigator.serial.getPorts();
      if (ports.length > 0) await this._openPort(ports[0]);
    } catch (err) {
      this._fail(err);
    }
  }

  async _openPort(port) {
    this._setStatus("connecting");
    try {
      await port.open({ baudRate: this.baudRate });
    } catch (err) {
      this._setStatus("disconnected");
      this._fail(err);
      return;
    }
    this.port = port;

    const textDecoder = new TextDecoderStream();
    this._readableClosed = port.readable.pipeTo(textDecoder.writable).catch(() => {});
    this.reader = textDecoder.readable.getReader();

    if (port.writable) {
      const textEncoder = new TextEncoderStream();
      this._writableClosed = textEncoder.readable.pipeTo(port.writable).catch(() => {});
      this.writer = textEncoder.writable.getWriter();
    }

    this._setStatus("connected");
    this._readLoop();
  }

  async _readLoop() {
    try {
      while (this.reader) {
        const { value, done } = await this.reader.read();
        if (done) break;
        this._buffer += value;
        const lines = this._buffer.split("\n");
        this._buffer = lines.pop();
        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (this.onLine) this.onLine(line);

          const values = this._parseValues(line);
          if (values) {
            this._values = values;
            this._value = values[0];
            const [id, sensorValue] = values;
            const hasId = values.length === 2 && Number.isInteger(id) && id >= 0;
            if (hasId) this._sensors[id] = sensorValue;

            if (this.onValues) this.onValues(values);
            if (this.onValue) this.onValue(values[0]);
            if (hasId && this.onSensor) this.onSensor(id, sensorValue);
          }
        }
      }
    } catch (err) {
      this._fail(err);
    }
  }

  /** "512,300" -> [512, 300]. Returns null unless every part is a number. */
  _parseValues(line) {
    const parts = line.split(",").map((part) => part.trim());
    if (parts.some((part) => part === "")) return null;
    const values = parts.map(Number);
    return values.some(Number.isNaN) ? null : values;
  }

  async _handleDisconnect() {
    await this._teardown();
    this._setStatus("disconnected");
  }

  async _teardown() {
    if (this.reader) {
      try {
        await this.reader.cancel();
      } catch (_) {}
      this.reader = null;
    }
    if (this.writer) {
      try {
        await this.writer.close();
      } catch (_) {}
      this.writer = null;
    }
    // The port can only close once both pipes have finished and released its streams.
    await this._readableClosed;
    await this._writableClosed;
    this._readableClosed = null;
    this._writableClosed = null;
    if (this.port) {
      try {
        await this.port.close();
      } catch (_) {}
      this.port = null;
    }
  }

  _setStatus(status) {
    this._status = status;
    this._button.style.display = status === "disconnected" ? "" : "none";
    this._disconnectButton.style.display = status === "connected" ? "" : "none";
    if (this.onStatusChange) this.onStatusChange(status);
  }

  _fail(err) {
    if (this.onError) this.onError(err);
    else console.error(err);
  }
}
