import { useState } from 'react';
import { clearSeen, countSeen, loadAvoidSeen, saveAvoidSeen } from '../library/seen';
import { useModal } from './Modal';

/**
 * The library's "unseen first" setting and the list of clues this device has played. The library
 * reads both from storage whenever it deals, so this only has to keep them up to date.
 */
export function PlayedClues() {
  const { confirm } = useModal();
  const [avoidSeen, setAvoidSeen] = useState(() => loadAvoidSeen());
  const [played, setPlayed] = useState(() => countSeen());

  const forget = async () => {
    const ok = await confirm({
      title: 'Forget played clues?',
      message:
        'Every clue becomes "new" again, so boards you deal may repeat clues your group has already seen.',
      confirmLabel: 'Forget them',
      tone: 'danger',
    });
    if (!ok) return;
    clearSeen();
    setPlayed(0);
  };

  return (
    <div className="flex flex-col gap-2 text-base text-white/70">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={avoidSeen}
          onChange={(event) => {
            setAvoidSeen(event.target.checked);
            saveAvoidSeen(event.target.checked);
          }}
        />
        <span>Deal clues I haven't played yet first</span>
      </label>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {played === 0
          ? 'Nothing played on this device yet.'
          : `${played} clue${played === 1 ? '' : 's'} played on this device.`}
        {played > 0 ? (
          <button
            type="button"
            className="text-neon-cyan underline hover:text-white"
            onClick={forget}
          >
            Forget them
          </button>
        ) : null}
      </p>
    </div>
  );
}
