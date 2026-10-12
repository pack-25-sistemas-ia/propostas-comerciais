'use client';

import dynamic from 'next/dynamic';

// Gráficos só no navegador: a biblioteca gera estilos em linha, que a CSP estrita bloquearia no HTML do servidor.
// Cada gráfico traz uma tabela alternativa acessível, e este esqueleto aparece enquanto carrega.
// (O Next exige que as opções do `dynamic` sejam um objeto literal, por isso se repetem.)
function Skeleton() {
  return (
    <div role="status" className="h-[330px] animate-pulse rounded-lg bg-black/10 dark:bg-white/10">
      <span className="sr-only">Carregando gráfico…</span>
    </div>
  );
}

export const EvolutionChartClient = dynamic(() => import('./charts').then((m) => m.EvolutionChart), { ssr: false, loading: Skeleton });
export const DecisionsChartClient = dynamic(() => import('./charts').then((m) => m.DecisionsChart), { ssr: false, loading: Skeleton });
export const ValueChartClient = dynamic(() => import('./charts').then((m) => m.ValueChart), { ssr: false, loading: Skeleton });
export const StatusChartClient = dynamic(() => import('./charts').then((m) => m.StatusChart), { ssr: false, loading: Skeleton });
export const RepChartClient = dynamic(() => import('./charts').then((m) => m.RepChart), { ssr: false, loading: Skeleton });
export const ClientsChartClient = dynamic(() => import('./charts').then((m) => m.ClientsChart), { ssr: false, loading: Skeleton });
export const RateChartClient = dynamic(() => import('./charts').then((m) => m.RateChart), { ssr: false, loading: Skeleton });
