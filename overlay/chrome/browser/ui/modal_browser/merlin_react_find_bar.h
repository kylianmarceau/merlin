// Copyright 2026 The Merlin Authors. BSD-style license; see LICENSE.
#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_FIND_BAR_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_REACT_FIND_BAR_H_
#include <memory>
class BrowserWindowInterface;
class FindBar;
namespace views { class Widget; }
namespace modal_browser {
std::unique_ptr<FindBar> CreateReactFindBar(BrowserWindowInterface* browser, views::Widget* widget);
}
#endif
