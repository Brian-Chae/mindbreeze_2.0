// SDD-245: 앱 공통 버튼. 역할별 홈(회원 /app · 상담사 /dashboard)의 주 CTA 규격이 정본이다.
// 클래스 생성기(buttonClass)를 링크·기존 버튼에서도 재사용해 같은 모양을 보장한다.
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { buttonClass, type ButtonStyleOptions } from './styles';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, Omit<ButtonStyleOptions, 'className'> {
  /** variant="icon"일 때 접근 가능한 이름이 필수다. */
  'aria-label'?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', tone = 'default', className, type = 'button', ...rest },
  ref,
) {
  return <button ref={ref} type={type} data-ui="button" data-variant={variant} className={buttonClass({ variant, size, tone, className })} {...rest} />;
});

export interface ButtonLinkProps extends Omit<LinkProps, 'className'>, Omit<ButtonStyleOptions, 'className'> {
  className?: string;
}

/** 라우터 링크 버튼. <button><a> 중첩 없이 같은 클래스를 사용한다. */
export const ButtonLink = forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink(
  { variant = 'primary', size = 'md', tone = 'default', className, ...rest },
  ref,
) {
  return <Link ref={ref} data-ui="button" data-variant={variant} className={buttonClass({ variant, size, tone, className })} {...rest} />;
});

export type ButtonAnchorProps = AnchorHTMLAttributes<HTMLAnchorElement> & Omit<ButtonStyleOptions, 'className'>;

/** 외부 링크(mailto/tel/새 창)용 <a> 버튼. */
export const ButtonAnchor = forwardRef<HTMLAnchorElement, ButtonAnchorProps>(function ButtonAnchor(
  { variant = 'primary', size = 'md', tone = 'default', className, ...rest },
  ref,
) {
  return <a ref={ref} data-ui="button" data-variant={variant} className={buttonClass({ variant, size, tone, className })} {...rest} />;
});
