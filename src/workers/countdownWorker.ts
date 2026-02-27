let timer: any = null;
let lights: any[] = [];

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'INIT') {
    lights = Array.isArray(msg.lights) ? msg.lights.map((l: any) => ({ ...l })) : [];
    self.postMessage({ lights });
  } else if (msg.type === 'UPDATE_LIGHT') {
    const { id, remaining_time, current_status } = msg.light || {};
    lights = lights.map((l: any) => (l.id === id ? { ...l, remaining_time, current_status } : l));
    self.postMessage({ lights });
  } else if (msg.type === 'TICK_START') {
    if (timer) return;
    timer = setInterval(() => {
      lights = lights.map((l: any) => ({
        ...l,
        remaining_time: l.remaining_time > 0 ? l.remaining_time - 1 : 0,
      }));
      self.postMessage({ lights });
    }, 1000);
  } else if (msg.type === 'STOP') {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
};
