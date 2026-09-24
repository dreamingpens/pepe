#!/usr/bin/env node
// A local protocol double. It never contacts a model or reads authentication.
const { createInterface } = require('node:readline')
const { appendFileSync } = require('node:fs')
const { randomUUID } = require('node:crypto')
const turns = new Map()
const send = (value) => process.stdout.write(JSON.stringify(value) + '\n')
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, method, params = {} } = JSON.parse(line)
  if (!method) return
  if (process.env.PEPE_TEST_RPC_LOG)
    appendFileSync(process.env.PEPE_TEST_RPC_LOG, JSON.stringify({ method, params }) + '\n')
  const reply = (result) => send({ id, result })
  const notify = (method, params) => send({ method, params })
  if (method === 'initialize') reply({ userAgent: 'Pepe Test' })
  else if (method === 'account/read') reply({ account: { type: 'chatgpt', planType: 'test' } })
  else if (method === 'model/list')
    reply({
      data: [
        {
          model: 'gpt-6-astra',
          displayName: 'GPT-6 Astra',
          supportedReasoningEfforts: ['low', 'medium', 'high'].map((reasoningEffort) => ({
            reasoningEffort,
          })),
          defaultReasoningEffort: 'medium',
          inputModalities: ['text', 'image'],
        },
      ],
    })
  else if (method === 'thread/start') reply({ thread: { id: randomUUID() } })
  else if (method === 'thread/resume') reply({ thread: { id: params.threadId } })
  else if (method === 'turn/start') {
    const turnId = randomUUID(),
      itemId = randomUUID(),
      threadId = params.threadId
    const prompt = params.input.find((i) => i.type === 'text')?.text || ''
    const question = prompt.split('Reader question:').at(-1)
    const referenceRegression = /reference regression/i.test(question)
    const answer = referenceRegression
      ? 'The source describes scaled attention. [p. 4](paper://page/4#line=p4-l29) See the encoder too. [p. 3](paper://page/3#line=p3-l18) [Invalid source](paper://page/4#line=p4-l999)\n\nAdditional context:'
      : /Summarize the paper/.test(prompt)
        ? /one concise paragraph/.test(prompt)
          ? 'The Transformer uses attention to model sequences. [p. 4](paper://page/4#line=p4-l15)'
          : [
              '- **Problem**',
              '  - Recurrent models process tokens sequentially.',
              '  - Sequential computation limits training parallelism.',
              '- **Method**',
              '  - The Transformer uses attention. [p. 4](paper://page/4#line=p4-l15)',
              '    - Queries and keys determine attention weights.',
              '    - Weighted values produce each output.',
              '  - Multiple heads capture different relationships.',
              '- **Findings**',
              '  - Translation quality improves on the evaluated benchmarks.',
              '  - Parallel computation reduces training time.',
              '- **Limitations**',
              '  - Full attention compares every pair of tokens.',
              '  - Longer sequences increase computational cost.',
            ].join('\n')
        : 'Attention combines queries, keys, and values: $QK^T$. [p. 4](paper://page/4#line=p4-l15)'
    reply({ turn: { id: turnId, status: 'inProgress' } })
    const timers = []
    timers.push(
      setTimeout(
        () =>
          notify('item/agentMessage/delta', {
            threadId,
            itemId,
            delta: referenceRegression ? answer : answer.slice(0, 35),
          }),
        30,
      ),
    )
    if (referenceRegression)
      for (let i = 1; i <= 35; i++)
        timers.push(
          setTimeout(
            () => notify('item/agentMessage/delta', { threadId, itemId, delta: ' context' }),
            i * 60 + 30,
          ),
        )
    timers.push(
      setTimeout(
        () => {
          if (/simulate failure/i.test(question))
            notify('turn/completed', {
              threadId,
              turn: {
                id: turnId,
                status: 'failed',
                error: { message: 'Test service unavailable' },
              },
            })
          else {
            notify('item/completed', {
              threadId,
              item: { id: itemId, type: 'agentMessage', text: answer },
            })
            notify('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } })
          }
          turns.delete(turnId)
        },
        referenceRegression ? 2500 : /slow response/i.test(question) ? 2500 : 150,
      ),
    )
    turns.set(turnId, { timers, threadId })
  } else if (method === 'turn/interrupt') {
    const run = turns.get(params.turnId)
    run?.timers.forEach(clearTimeout)
    turns.delete(params.turnId)
    reply({})
    notify('turn/completed', {
      threadId: params.threadId,
      turn: { id: params.turnId, status: 'interrupted' },
    })
  } else if (id !== undefined) reply({})
})
