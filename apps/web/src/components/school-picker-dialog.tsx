import { Button } from './ui/button.tsx';
import { Dialog, DialogContent, DialogFooter } from './ui/dialog.tsx';
import { SchoolPicker } from './school-picker.tsx';
import type { PresetContext, School } from '../screens/school-picker-model.ts';
import { schoolCopy } from '../copy/timetable-school.ts';

export interface SchoolPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: PresetContext | null;
  selectedId: string | null;
  /** 上次用过的学校：置顶并可一键套用 */
  pinned: School | null;
  onPick: (school: School) => void;
}

/** 选校弹窗：搜索 + 筛选 + 列表，选中即关闭；首启页与设置页共用同一套选校入口。 */
export function SchoolPickerDialog({
  open,
  onOpenChange,
  context,
  selectedId,
  pinned,
  onPick,
}: SchoolPickerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={schoolCopy.dialogTitle} description={schoolCopy.dialogDescription}>
        <SchoolPicker
          context={context}
          selectedId={selectedId}
          pinned={pinned}
          onPick={(school) => {
            onPick(school);
            onOpenChange(false);
          }}
          listClassName="max-h-[50vh]"
        />
        <DialogFooter>
          <Button variant="ghost" aria-label={schoolCopy.closeAria} onClick={() => onOpenChange(false)}>
            {schoolCopy.cancel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
