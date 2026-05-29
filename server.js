import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from './server/bootstrap.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const { server, port } = createServer(__dirname);

server.listen(port, () => {
  console.log(`Strm Manager listening on http://localhost:${port}`);
});
