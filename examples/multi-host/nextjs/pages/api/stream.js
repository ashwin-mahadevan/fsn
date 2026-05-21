export default function handler(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let i = 0;
  const timer = setInterval(() => {
    i++;
    res.write(`data: chunk ${i} — ${new Date().toISOString()}\n\n`);
    if (i >= 10) {
      clearInterval(timer);
      res.end();
    }
  }, 300);

  req.on('close', () => clearInterval(timer));
}
