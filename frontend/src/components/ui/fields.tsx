// SDD-245: 입력·선택·텍스트영역 공통 스타일. native 요소를 그대로 감싸 value/onChange/ref/aria를 보존한다.
import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { fieldClass } from './styles';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} data-ui="input" className={fieldClass('input', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...rest }, ref) {
  return <select ref={ref} data-ui="select" className={fieldClass('select', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} data-ui="textarea" className={fieldClass('textarea', className)} {...rest} />;
});
