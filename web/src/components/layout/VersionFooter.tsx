import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { BuildInfo } from '../../api/types';

/**
 * Rodapé da aplicação, com a versão em pé — na mesma pegada do `pihole -v`:
 * a release versionada, o commit exato que a API leu do repositório, e se já
 * existe commit novo esperando no remoto.
 *
 * Uma requisição estática por abertura de tela (o roteador é por hash, então
 * este componente não remonta) e, se ela falhar, o rodapé não aparece:
 * versão errada pior que versão nenhuma.
 *
 * `update_available` vem junto do mesmo `/api` e pode ser `null` — sem
 * repositório ou sem rede não há como comparar, e nesse caso o rodapé diz o
 * que sabe e fica quieto sobre o resto.
 */
export function VersionFooter() {
  const [info, setInfo] = useState<BuildInfo | null>(null);

  useEffect(() => {
    let vivo = true;
    api
      .getBuildInfo()
      .then((data) => {
        if (vivo) setInfo(data);
      })
      .catch(() => {
        // Sem repositório montado ou API fora do ar: sem rodapé, sem exceção.
      });
    return () => {
      vivo = false;
    };
  }, []);

  if (!info) return null;

  return (
    <footer
      className="shrink-0 border-t border-line px-4 py-2.5 text-center text-[0.78rem] text-muted"
      data-testid="app-version"
    >
      OndeJoga {info.version}
      {info.commit ? (
        <>
          {' · '}
          <span>{info.branch ?? 'sem branch'}</span>
          {' @ '}
          <code>{info.commit}</code>
        </>
      ) : null}
      {info.source === 'git' ? null : <span> · sem repositório no container</span>}
      {info.update_available === true ? (
        <span className="text-warn"> · nova versão disponível</span>
      ) : info.update_available === false ? (
        <span> · atualizado</span>
      ) : null}
    </footer>
  );
}
