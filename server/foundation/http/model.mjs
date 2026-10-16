// The Foundation's route of the one model (fd25): the Flow's model as the last build kept it (arch/flowmodel.mjs), the same the
// page draws and "Tudo em dia?" reads. null before the first build. The Flow's own routes (/api/arch/:id/model...) build it on
// demand; this one only reads what is stored. The owner's drawing and the AI's study of the old block (layout, overrides, study)
// were never built and have no route: the drawing is the Flow's draft (/api/arch/:id/draft).
import { readModelCache } from '../../arch/flowmodel.mjs';

export const routes = [
  {
    method: 'GET', path: 'model',
    run: (ctx) => (ctx.demo ? ctx.read('model.json', null) : readModelCache(ctx.smDir, ctx.project.id)?.model ?? null),
  },
];
