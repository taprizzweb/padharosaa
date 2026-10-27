// A clock for the reception alarm. Timers on a hidden tab are slowed down by the browser (to once a minute after a while); a worker's
// timer is not, so the alarm keeps its beat while the tab is in the background. It holds no data and does nothing else.
let timer = null;
self.onmessage = (e) => {
  if (e.data === 'start' && !timer) timer = setInterval(() => self.postMessage('tick'), 1000);
  if (e.data === 'stop' && timer) { clearInterval(timer); timer = null; }
};
