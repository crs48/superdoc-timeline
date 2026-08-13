#!/usr/bin/env node

/**
 * Patched y/hub entry — derived from `bin/yhub.js` inside
 * `ghcr.io/yjs/yhub/standalone:latest` (AGPL-3.0). Published in this repository
 * in accordance with the AGPL.
 *
 * NOTE: the published image is older than yjs/yhub master. Master's bin/yhub.js
 * delegates to bin/conf.js; the image's version inlines the whole config, so
 * this file replaces bin/yhub.js itself — a conf.js overlay would be dead code.
 *
 * The only functional change is authentication. The stock image assigns every
 * connection a RANDOM user id:
 *
 *   const userIdChoices = ['Calvin Hobbes', 'Charlie Brown', 'Dilbert Adams', 'Garfield']
 *   async readAuthInfo (req) { return { userid: random.oneOf(userIdChoices) } }
 *
 * which makes all attribution decorative. This version records the client's
 * `yauth` query parameter — SuperDoc forwards it via `v2Collaboration.params` —
 * so `activity[].by` is the client's stable deviceId.
 *
 * Open by design: this take-home has no accounts and no permission model. The
 * client asserts its own deviceId and we take it at face value, which is
 * exactly enough to attribute a chart nobody is authorized against.
 */

import * as number from 'lib0/number'
import * as env from 'lib0/environment'
import * as yhub from '@y/hub'
import { logger } from '../src/logger.js'

const port = number.parseInt(env.getConf('port') || '3002')

logger.info({ port }, 'starting server (patched auth: yauth -> userid)')

yhub.createYHub({
  redis: {
    url: env.ensureConf('redis'),
    prefix: 'yhub',
    taskDebounce: 10000,
    minMessageLifetime: 60000
  },
  postgres: env.ensureConf('postgres'),
  persistence: [],
  server: {
    port,
    auth: {
      // uws recycles the request object after the first await — read the query
      // synchronously, before returning.
      async readAuthInfo (req) {
        const claimed = req.getQuery('yauth')
        const userid = claimed && claimed.length > 0 && claimed.length <= 64
          ? claimed
          : 'anonymous'
        return { userid }
      },
      // always grant rw access — there is deliberately no permission model
      async getAccessType () { return 'rw' }
    }
  },
  worker: {
    taskConcurrency: 5
  }
})
