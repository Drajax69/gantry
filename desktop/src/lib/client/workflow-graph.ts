import type { Workflow } from './gantry';

/** Upgrade the editable canvas without rewriting saved/running ticket snapshots. */
export function canvasWorkflow(graph: Workflow): Workflow {
  if (graph.edges !== undefined) return structuredClone(graph);
  const edges: NonNullable<Workflow['edges']> = [];
  for (const node of graph.nodes) {
    for (const parent of node.dependsOn) {
      const others = node.dependsOn.filter((id) => id !== parent).map((id) => graph.nodes.find((n) => n.id === id)?.label || id);
      edges.push({
        id: `edge-${edges.length}`,
        source: parent,
        target: node.id,
        label: others.length ? `When complete and ${others.join(' and ')} also completed successfully` : 'When completed successfully',
      });
    }
    if (node.retryTarget) edges.push({ id: `edge-${edges.length}`, source: node.id, target: node.retryTarget, label: 'When changes are requested' });
  }
  return {
    ...graph,
    entryNodeId: graph.nodes.find((n) => !n.dependsOn.length)?.id ?? graph.nodes[0]?.id,
    edges,
    nodes: graph.nodes.map((n) => ({ ...n, kind: 'agent' as const })),
  };
}
export function nodePositions(graph: Workflow): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const levels = new Map<string, number>();
  for (let pass = 0; pass < graph.nodes.length; pass++)
    for (const n of graph.nodes)
      if (!levels.has(n.id) && n.dependsOn.every((id) => levels.has(id))) levels.set(n.id, Math.max(-1, ...n.dependsOn.map((id) => levels.get(id)!)) + 1);
  const rows = new Map<number, number>();
  graph.nodes.forEach((n, i) => {
    const level = levels.get(n.id) ?? i;
    const row = rows.get(level) ?? 0;
    rows.set(level, row + 1);
    positions[n.id] = n.position ?? { x: 64 + level * 300, y: 100 + row * 190 };
  });
  return positions;
}
