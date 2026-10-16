// The ponytail intensity married to the Cérebro's efforts (id142, or47, task 1): the vendored discipline's three
// levels are the program's own effort vocabulary — lite = low, full = medium/high, ultra = xhigh/max. One body.
export const PONYTAIL_BY_EFFORT = Object.freeze({ low: 'lite', medium: 'full', high: 'full', xhigh: 'ultra', max: 'ultra' });

export const ponytailOf = (effort) => PONYTAIL_BY_EFFORT[effort] ?? null;
