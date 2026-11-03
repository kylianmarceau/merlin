#ifndef CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADBLOCK_BUTTON_H_
#define CHROME_BROWSER_UI_MODAL_BROWSER_MERLIN_ADBLOCK_BUTTON_H_

#include <memory>
#include <optional>

#include "base/functional/callback.h"
#include "base/memory/raw_ptr.h"
#include "base/timer/timer.h"
#include "content/public/browser/weak_document_ptr.h"
#include "ui/base/metadata/metadata_header_macros.h"
#include "ui/menus/simple_menu_model.h"
#include "ui/views/controls/button/button.h"

class BrowserWindowInterface;
namespace views {
class MenuRunner;
}
namespace modal_browser {
class MerlinAdblockButton : public views::Button,
                            public ui::SimpleMenuModel::Delegate {
  METADATA_HEADER(MerlinAdblockButton, views::Button)
 public:
  MerlinAdblockButton(BrowserWindowInterface* browser,
                      base::RepeatingClosure settings);
  ~MerlinAdblockButton() override;
  void Update();
  void SetSurface(std::optional<SkColor> surface);
  gfx::Size CalculatePreferredSize(const views::SizeBounds&) const override;
  void PaintButtonContents(gfx::Canvas* canvas) override;
  void StateChanged(ButtonState old) override;
  bool IsCommandIdChecked(int command) const override;
  bool IsCommandIdEnabled(int command) const override;
  void ExecuteCommand(int command, int flags) override;
  ui::SimpleMenuModel* BuildMenuForTesting();

 private:
  void Pressed(const ui::Event& event);
  content::RenderFrameHost* MenuFrame() const;
  const raw_ptr<BrowserWindowInterface> browser_;
  base::RepeatingClosure settings_;
  base::RepeatingTimer timer_;
  std::u16string text_;
  std::optional<SkColor> surface_;
  content::WeakDocumentPtr menu_document_;
  std::unique_ptr<ui::SimpleMenuModel> menu_;
  std::unique_ptr<views::MenuRunner> runner_;
};
}  // namespace modal_browser
#endif
