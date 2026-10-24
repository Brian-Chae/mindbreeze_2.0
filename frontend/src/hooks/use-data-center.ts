import { useEffect, useState } from "react";
import { dataCenterGet } from "../lib/api/data-center";
// 화면 간 캐시를 만들지 않고 전환 시 응답과 버퍼를 폐기한다.
export function useDataCenter<T>(
  path: string | null,
  params: Record<string, string | number | undefined> = {},
) {
  const key = JSON.stringify(params);
  const requestKey = path + key;
  const [state, setState] = useState<{
    data: T | null;
    loading: boolean;
    error: string | null;
    requestKey?: string;
  }>({ data: null, loading: !!path, error: null });
  useEffect(() => {
    const controller = new AbortController();
    setState({ data: null, loading: !!path, error: null, requestKey });
    if (path)
      void dataCenterGet<T>(
        path,
        JSON.parse(key) as Record<string, string>,
        controller.signal,
      )
        .then((data) => {
          if (!controller.signal.aborted)
            setState({ data, loading: false, error: null, requestKey });
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setState({
              data: null,
              loading: false,
              error:
                "데이터를 불러오지 못했습니다. 권한과 조회 범위를 확인해 주세요.",
              requestKey,
            });
        });
    return () => controller.abort();
    // requestKey 는 path+key 로 파생되므로 의존성에 중복해 넣지 않는다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key]);
  return state.requestKey === requestKey
    ? state
    : { data: null, loading: !!path, error: state.error };
}
