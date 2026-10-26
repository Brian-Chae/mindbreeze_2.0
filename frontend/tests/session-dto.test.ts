import { resolve } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';

it('세션 부모 필드는 생략·null을 허용하고 값의 타입을 제한한다', () => {
  // 파일을 생성하지 않고 실제 SessionDto를 참조하는 계약을 컴파일한다.
  const fileName = resolve('tests/session-dto-contract.ts');
  const source = `
    import type { SessionDto } from '../src/lib/api/session';
    type ParentFields = Pick<SessionDto, 'class_id' | 'class_title' | 'seq' | 'area'>;
    const omitted: ParentFields = {};
    const empty: ParentFields = { class_id: null, class_title: null, seq: null, area: null };
    const meditation: ParentFields = { class_id: 'class-1', class_title: '명상', seq: 1, area: 'meditation' };
    const counseling: ParentFields = { area: 'counseling' };
    // @ts-expect-error 클래스 ID는 문자열이다.
    const invalidId: ParentFields = { class_id: 1 };
    // @ts-expect-error 클래스 제목은 문자열이다.
    const invalidTitle: ParentFields = { class_title: 1 };
    // @ts-expect-error 회차는 숫자이다.
    const invalidSeq: ParentFields = { seq: '1' };
    // @ts-expect-error 영역은 명상 또는 상담이다.
    const invalidArea: ParentFields = { area: 'other' };
  `;
  const options: ts.CompilerOptions = {
    noEmit: true,
    strict: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (path, languageVersion, onError, shouldCreateNewSourceFile) =>
    path === fileName
      ? ts.createSourceFile(path, source, languageVersion, true)
      : getSourceFile(path, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([fileName], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  expect(diagnostics).toEqual([]);
});
