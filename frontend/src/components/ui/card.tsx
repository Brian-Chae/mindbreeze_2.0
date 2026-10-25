// SDD-245: 앱 공통 카드. 반경·테두리·그림자만 소유하고 내부 배치는 페이지가 정한다.
import { forwardRef, type HTMLAttributes } from 'react';
import { cardClass, type CardPadding } from './styles';

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  padding?: CardPadding;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ padding = 'default', className, ...rest }, ref) {
  return <div ref={ref} data-ui="card" className={cardClass(padding, className)} {...rest} />;
});
