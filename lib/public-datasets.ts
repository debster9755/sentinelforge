import registry from '@/data/public-datasets.json';

export type PublicDatasetSource = (typeof registry.sources)[number];

export const publicDatasetRegistry = registry;

export function getPublicDataset(id: string): PublicDatasetSource | undefined {
  return registry.sources.find((source) => source.id === id);
}

export function sourceCommand(source: PublicDatasetSource, limit = 200): string {
  if (source.integration === 'direct_import') {
    return `npm run dataset -- import ${source.id} --network --accept-license --limit ${limit}`;
  }
  if (source.integration === 'result_adapter') {
    return `npm run dataset -- adapt ${source.id} --input ./runs/agentdojo-results.jsonl`;
  }
  return `npm run dataset -- inspect ${source.id}`;
}
