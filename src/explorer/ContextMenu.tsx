/*
 * @license
 * Copyright 2024 Google LLC
 *
 * Use of this source code is governed by a BSD-style
 * license that can be found in the LICENSE file or at
 * https://developers.google.com/open-source/licenses/bsd
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState
} from 'react';

export interface IMenuItem {
  label: string;
  onClick: () => void;
}

type OpenFn = (event: React.MouseEvent, items: IMenuItem[]) => void;

const MenuContext = createContext<OpenFn>(() => undefined);

export function useMenu(): OpenFn {
  return useContext(MenuContext);
}

interface IMenuState {
  x: number;
  y: number;
  items: IMenuItem[];
}

export function MenuProvider({
  children
}: {
  children: React.ReactNode;
}): JSX.Element {
  const [menu, setMenu] = useState<IMenuState | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const open = useCallback<OpenFn>((event, items) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, items });
  }, []);

  useEffect(() => {
    if (!menu) {
      return;
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu, close]);

  return (
    <MenuContext.Provider value={open}>
      {children}
      {menu && (
        <div
          className="bq-ctx-backdrop"
          onClick={close}
          onContextMenu={e => {
            e.preventDefault();
            close();
          }}
        >
          <ul
            className="bq-ctx-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={e => e.stopPropagation()}
          >
            {menu.items.map((item, i) => (
              <li
                key={i}
                className="bq-ctx-item"
                onClick={() => {
                  item.onClick();
                  close();
                }}
              >
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </MenuContext.Provider>
  );
}
