// Runs inside the isolated renderer. Records synthetic playback state only.
function installPreviewDiagnostics(scenario = 'normal') {
  const Original = window.AudioContext;
  const audio = (window.__audio = {
    contexts: [],
    gains: [],
    starts: [],
    stops: 0,
    events: [],
    scenario,
  });
  if (scenario === 'paused-video-position') {
    const position = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'currentTime',
    );
    Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
      configurable: true,
      get() {
        const time = position.get.call(this);
        return this instanceof HTMLVideoElement && this.paused
          ? Math.max(0, time - 0.1)
          : time;
      },
      set(value) {
        position.set.call(this, value);
      },
    });
  }
  const record = (event, detail = {}) => {
    audio.events.push({ at: Math.round(performance.now()), event, ...detail });
    if (audio.events.length > 300) audio.events.shift();
  };
  const media = (player) => ({
    time: player.currentTime,
    ready: player.readyState,
    paused: player.paused,
    seeking: player.seeking,
  });
  for (const event of [
    'loadedmetadata',
    'loadeddata',
    'seeking',
    'seeked',
    'waiting',
    'canplay',
    'play',
    'playing',
    'pause',
    'ended',
  ]) {
    document.addEventListener(
      event,
      (e) => {
        if (e.target instanceof HTMLVideoElement)
          record('video:' + event, media(e.target));
      },
      true,
    );
  }
  window.AudioContext = class extends Original {
    constructor(...args) {
      super(...args);
      audio.contexts.push(this);
      this.addEventListener('statechange', () =>
        record('audio:state', { state: this.state, time: this.currentTime }),
      );
      record('audio:create', { state: this.state });
    }
    async resume() {
      record('audio:resume', { state: this.state, time: this.currentTime });
      await super.resume();
      record('audio:resumed', { state: this.state, time: this.currentTime });
    }
    async decodeAudioData(bytes) {
      record('audio:decode');
      const buffer = await super.decodeAudioData(bytes);
      if (scenario === 'suspend-during-load' && !audio.injected) {
        audio.injected = true;
        await this.suspend();
        record('injected:suspend-after-decode', {
          state: this.state,
          time: this.currentTime,
        });
      }
      record('audio:decoded', { duration: buffer.duration, state: this.state });
      return buffer;
    }
    createGain() {
      const node = super.createGain();
      audio.gains.push(node);
      return node;
    }
    createBufferSource() {
      const node = super.createBufferSource(),
        start = node.start.bind(node),
        stop = node.stop.bind(node);
      node.start = (...args) => {
        audio.starts.push(args);
        record('audio:start', {
          args,
          time: this.currentTime,
          state: this.state,
        });
        return start(...args);
      };
      node.stop = (...args) => {
        audio.stops++;
        record('audio:stop', { time: this.currentTime, state: this.state });
        return stop(...args);
      };
      return node;
    }
  };
  return true;
}
function previewDiagnostics() {
  const a = window.__audio,
    player = document.querySelector('.preview-screen video');
  return {
    scenario: a?.scenario,
    cursor: Number(document.querySelector('[aria-label="预览进度"]')?.value),
    button: document.querySelector('.transport button')?.textContent,
    notice: document.querySelector('.preview-view [role="status"]')
      ?.textContent,
    hidden: document.hidden,
    video: player && {
      currentTime: player.currentTime,
      paused: player.paused,
      seeking: player.seeking,
      readyState: player.readyState,
      networkState: player.networkState,
      ended: player.ended,
    },
    audio: a && {
      contexts: a.contexts.map((c) => ({
        state: c.state,
        currentTime: c.currentTime,
      })),
      starts: a.starts,
      stops: a.stops,
      events: a.events,
    },
  };
}
module.exports = { installPreviewDiagnostics, previewDiagnostics };
