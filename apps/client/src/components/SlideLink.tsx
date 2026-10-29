import { Link } from 'react-router-dom';
import type { LinkProps } from 'react-router-dom';
import { useSlideNavigate } from '../lib/slide';

/** A Link that slides to the next screen instead of jumping. Ctrl, Cmd and middle clicks still work as usual. */
export function SlideLink({ to, onClick, ...rest }: LinkProps & { to: string }) {
  const slideTo = useSlideNavigate();
  return (
    <Link
      to={to}
      {...rest}
      onClick={(event) => {
        onClick?.(event);
        const plain =
          event.button === 0 &&
          !event.metaKey &&
          !event.ctrlKey &&
          !event.shiftKey &&
          !event.altKey &&
          (rest.target === undefined || rest.target === '_self');
        if (event.defaultPrevented || !plain) return;
        event.preventDefault();
        slideTo(to, { replace: rest.replace, state: rest.state });
      }}
    />
  );
}
