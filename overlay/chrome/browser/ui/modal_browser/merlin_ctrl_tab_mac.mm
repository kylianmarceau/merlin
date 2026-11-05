// Copyright 2026 The modal_browser Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

#import <AppKit/AppKit.h>
#include <Carbon/Carbon.h>  // kVK_* key codes

#include <optional>
#include <utility>

#include "base/functional/bind.h"
#include "base/location.h"
#include "base/memory/weak_ptr.h"
#include "base/task/sequenced_task_runner.h"
#include "chrome/browser/ui/modal_browser/merlin_ctrl_tab.h"

namespace modal_browser {

namespace {

std::optional<CtrlTabKeyWatch::Key> KeyFor(NSEvent* event) {
  switch (event.keyCode) {
    case kVK_Escape:
      return CtrlTabKeyWatch::Key::kEscape;
    case kVK_Return:
    case kVK_ANSI_KeypadEnter:
      return CtrlTabKeyWatch::Key::kReturn;
    case kVK_LeftArrow:
      return CtrlTabKeyWatch::Key::kLeft;
    case kVK_RightArrow:
      return CtrlTabKeyWatch::Key::kRight;
    case kVK_UpArrow:
      return CtrlTabKeyWatch::Key::kUp;
    case kVK_DownArrow:
      return CtrlTabKeyWatch::Key::kDown;
    default:
      return std::nullopt;
  }
}

// A local monitor sees this app's key events before any window does, so
// the page never gets Esc or the arrows while the switcher is up, and the
// Ctrl release arrives wherever focus is.
class MacCtrlTabKeyWatch : public CtrlTabKeyWatch {
 public:
  explicit MacCtrlTabKeyWatch(Callbacks callbacks)
      : callbacks_(std::move(callbacks)) {
    base::WeakPtr<MacCtrlTabKeyWatch> weak = weak_factory_.GetWeakPtr();
    monitor_ = [NSEvent
        addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged |
                                             NSEventMaskKeyDown
                                     handler:^NSEvent*(NSEvent* event) {
                                       MacCtrlTabKeyWatch* self = weak.get();
                                       return self && self->Handle(event)
                                                  ? nil
                                                  : event;
                                     }];
  }

  ~MacCtrlTabKeyWatch() override {
    if (monitor_) {
      [NSEvent removeMonitor:monitor_];
    }
  }

 private:
  // Returns true to swallow the event. Never runs a callback directly: they
  // may destroy this watch, and with it the monitor that is running.
  bool Handle(NSEvent* event) {
    if (event.type == NSEventTypeFlagsChanged) {
      if (!(event.modifierFlags & NSEventModifierFlagControl)) {
        base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
            FROM_HERE, callbacks_.control_released);
      }
      return false;
    }
    const std::optional<Key> key = KeyFor(event);
    if (!key) {
      return false;
    }
    base::SequencedTaskRunner::GetCurrentDefault()->PostTask(
        FROM_HERE, base::BindOnce(callbacks_.key, *key));
    return true;
  }

  Callbacks callbacks_;
  id __strong monitor_ = nil;
  base::WeakPtrFactory<MacCtrlTabKeyWatch> weak_factory_{this};
};

}  // namespace

// static
std::unique_ptr<CtrlTabKeyWatch> CtrlTabKeyWatch::Start(Callbacks callbacks) {
  return std::make_unique<MacCtrlTabKeyWatch>(std::move(callbacks));
}

// static
bool CtrlTabKeyWatch::IsControlDown() {
  return NSEvent.modifierFlags & NSEventModifierFlagControl;
}

}  // namespace modal_browser
