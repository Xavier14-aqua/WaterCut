import { net, protocol } from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import type { ApplicationContext } from '../services/application-context';

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'watercut-media',
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}
export function registerMediaProtocol(context: ApplicationContext) {
  const { mediaPaths } = context;
  protocol.handle('watercut-media', (request) => {
    try {
      const url = new URL(request.url),
        id = decodeURIComponent(url.pathname.slice(1)),
        entry = url.hostname === 'asset' ? mediaPaths.get(id) : undefined;
      if (!entry)
        return new Response('Not found', {
          status: 404,
        });
      const real = realpathSync(entry.file),
        root = realpathSync(entry.root) + path.sep;
      if (!real.toLowerCase().startsWith(root.toLowerCase()))
        return new Response('Forbidden', {
          status: 403,
        });
      return net.fetch(pathToFileURL(real).toString()).then((response) => {
        const headers = new Headers(response.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(response.body, {
          status: response.status,
          statusText: response.statusText,
          headers,
        });
      });
    } catch {
      return new Response('Not found', {
        status: 404,
      });
    }
  });
}
