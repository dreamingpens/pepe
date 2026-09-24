import { mkdir, readFile, writeFile, access } from 'node:fs/promises'
import { indexPdf } from '../electron/pdf-worker.mjs'
import { fetchPublic, validatePdf } from '../electron/network.mjs'

const corpus = [
  ['1706.03762v5', 'Attention Is All You Need'],
  ['1810.04805', 'BERT'],
  ['1512.03385', 'Deep Residual Learning'],
  ['1412.6980', 'Adam'],
  ['2005.14165', 'Language Models are Few-Shot Learners'],
  ['2010.11929', 'Vision Transformer'],
  ['2106.09685', 'LoRA'],
  ['2006.11239', 'Denoising Diffusion Probabilistic Models'],
  ['2103.00020', 'CLIP'],
  ['2005.11401', 'Retrieval-Augmented Generation'],
]
await mkdir('tests/corpus', { recursive: true })
await mkdir('artifacts', { recursive: true })
const report = []
for (const [id, title] of corpus) {
  const path = `tests/corpus/${id}.pdf`
  try {
    await access(path)
  } catch {
    const bytes = await fetchPublic(`https://arxiv.org/pdf/${id}`)
    validatePdf(bytes)
    await writeFile(path, bytes)
    await new Promise((resolve) => setTimeout(resolve, 3100))
  }
  const index = await indexPdf(path)
  const references = index.references
  const result = {
    id,
    title,
    url: `https://arxiv.org/abs/${id}`,
    bytes: (await readFile(path)).length,
    pages: index.pages.length,
    indexMs: Math.round(index.elapsedMs),
    references: references.length,
    numbered: references.filter((r) => r.number).length,
    authorYear: references.filter((r) => !r.number && r.key === `${r.surname}${r.year}`).length,
    keyed: references.filter((r) => !r.number && r.key !== `${r.surname}${r.year}`).length,
    citationLines: index.pages.flatMap((p) => p.lines).filter((l) => l.citations.length).length,
    figures: index.pages.flatMap((p) => p.visuals).filter((v) => v.kind === 'figure').length,
    formulas: index.pages.flatMap((p) => p.visuals).filter((v) => v.kind === 'formula').length,
  }
  report.push(result)
  await writeFile(`tests/corpus/${id}.index.json`, JSON.stringify(index))
  console.log(JSON.stringify(result))
}
await writeFile(
  'artifacts/corpus-report.json',
  JSON.stringify({ generatedAt: new Date().toISOString(), papers: report }, null, 2),
)
if (report.some((paper) => paper.references < 5 || paper.citationLines < 3)) process.exitCode = 1
