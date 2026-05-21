export async function load() {
  return {
    timestamp: new Date().toISOString(),
    random: Math.floor(Math.random() * 100_000),
  };
}
