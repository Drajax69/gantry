import { test } from 'vitest';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseProjectConfig } from '../packages/shared/src/config/schema.js';
import { buildServiceEnv } from '../packages/server/src/supervisor/env.js';
import { tempDir, write } from './helpers.js';
test('dependency origins override primary, checkout and profile URLs without changing env files', async () => {
  const temp = await tempDir('gantry-env-');
  try {
    const config = parseProjectConfig({ apiVersion: 'gantry.dev/v1', project: {id:'fixture',name:'Fixture'}, repositories:[{id:'web',path:'web'},{id:'api',path:'api'}], services:[{id:'web',repository:'web',runtime:'vite',dependsOn:['api'],envFiles:['.env'],env:{VITE_BACKEND_URL:'${origin.api}'}},{id:'api',repository:'api',runtime:'node'}] });
    assert.ok(config.ok); if (!config.ok) return;
    const primary=path.join(temp.dir,'primary'), checkout=path.join(temp.dir,'checkout');
    await write(path.join(primary,'.env'),'VITE_BACKEND_URL=http://localhost:3000\n');
    await write(path.join(checkout,'.env'),'VITE_BACKEND_URL=http://localhost:3001\n');
    await write(path.join(temp.dir,'profile.env'),'VITE_BACKEND_URL=http://localhost:3002\n');
    for (const port of [5279,5283]) {
      const env=await buildServiceEnv({project:config.config,workspace:temp.dir,primaryPath:primary,checkoutPath:checkout,service:config.config.services[0]!,port:5280,environment:{id:'test',label:'Test',default:true,envFiles:{web:'profile.env'},env:{},requireKeys:{}},vars:{'origin.api':`http://127.0.0.1:${port}`}});
      assert.equal(env.VITE_BACKEND_URL,`http://127.0.0.1:${port}`);
    }
  } finally { await temp.cleanup(); }
});
