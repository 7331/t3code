import * as NodeHttp from "node:http";
import * as NodeFS from "node:fs";
// A receipt barrier resolves only on an actual HTTP export after the requested boundary.
export async function collector(directory) {
  const receipts = [];
  const waiters = new Set();
  const server = NodeHttp.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const receipt = {
        at: new Date().toISOString(),
        path: req.url,
        contentType: req.headers["content-type"],
        body: Buffer.concat(chunks).toString("utf8"),
      };
      NodeFS.appendFileSync(directory + "/otlp.ndjson", JSON.stringify(receipt) + "\n");
      receipts.push(receipt);
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      for (const w of waiters)
        if (receipts.length > w.boundary && w.predicate(receipt)) {
          waiters.delete(w);
          clearTimeout(w.timer);
          w.resolve(receipt);
        }
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  return {
    port,
    receipts,
    close: () => new Promise((resolve) => server.close(resolve)),
    wait(predicate = () => true, boundary = receipts.length) {
      return new Promise((resolve, reject) => {
        const w = {
          predicate,
          boundary,
          resolve,
          timer: setTimeout(() => {
            waiters.delete(w);
            reject(new Error("OTLP receipt barrier timed out"));
          }, 30000),
        };
        const existing = receipts.slice(boundary).find(predicate);
        if (existing) {
          clearTimeout(w.timer);
          resolve(existing);
        } else waiters.add(w);
      });
    },
  };
}
export function points(receipt) {
  const body = JSON.parse(receipt.body);
  const result = [];
  for (const resource of body.resourceMetrics ?? [])
    for (const scope of resource.scopeMetrics ?? [])
      for (const metric of scope.metrics ?? [])
        for (const point of (metric.sum ?? metric.histogram ?? metric.gauge ?? {}).dataPoints ??
          []) {
          const attrs = Object.fromEntries(
            (point.attributes ?? []).map((a) => [a.key, Object.values(a.value)[0]]),
          );
          result.push({
            name: metric.name,
            unit: metric.unit,
            attrs,
            point,
            resource: resource.resource,
          });
        }
  return result;
}
