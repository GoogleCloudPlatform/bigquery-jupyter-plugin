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
import { createPortal } from 'react-dom';

// Rough menu size, used to keep the menu inside the viewport when opened near
// an edge.
const MENU_WIDTH = 180;
const ITEM_HEIGHT = 28;

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
    // clientX/clientY are viewport coordinates; clamp so the menu stays on
    // screen when opened near the right/bottom edge.
    const menuHeight = items.length * ITEM_HEIGHT + 8;
    const x = Math.max(
      4,
      Math.min(event.clientX, window.innerWidth - MENU_WIDTH - 4)
    );
    const y = Math.max(
      4,
      Math.min(event.clientY, window.innerHeight - menuHeight - 4)
    );
    setMenu({ x, y, items });
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
      {menu &&
        createPortal(
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
          </div>,
          document.body
        )}
    </MenuContext.Provider>
  );
}
