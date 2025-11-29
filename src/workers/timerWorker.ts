let timer: any = null;
let interval = 1000;

self.onmessage = (e: MessageEvent) => {
  const msg = e.data || {};
  if (msg.type === 'START') {
    interval = msg.interval || 1000;
    if (timer) return;
    timer = setInterval(() => {
      // send tick with timestamp for drift correction if needed
      self.postMessage({ type: 'TICK', ts: Date.now() });
    }, interval);
  } else if (msg.type === 'STOP') {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  } else if (msg.type === 'SET_INTERVAL') {
    interval = msg.interval || 1000;
    if (timer) {
      clearInterval(timer);
      timer = setInterval(() => {
        self.postMessage({ type: 'TICK', ts: Date.now() });
      }, interval);
    }
  }
};
