import test from 'node:test';
import assert from 'node:assert/strict';
import { checkWidgetLayouts, findDisallowedViews, providerLayouts, referencedLayouts } from './check-widget-layouts.mjs';

const xml = (body) => `<?xml version="1.0" encoding="utf-8"?>\n${body}`;

test('裸 View 被标出且行号正确', () => {
  const source = xml(`<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent">
    <TextView android:id="@+id/title" />
    <View
        android:layout_width="match_parent"
        android:layout_height="1dp" />
</LinearLayout>`);
  assert.deepEqual(findDisallowedViews(source), [{ tag: 'View', line: 5 }]);
});

test('白名单内的标签全部通过', () => {
  const source = xml(`<FrameLayout>
  <LinearLayout><TextView/><ImageView /><ImageButton/><Button/></LinearLayout>
  <RelativeLayout><ProgressBar/><Chronometer/><AnalogClock/></RelativeLayout>
  <GridLayout/><ViewFlipper/><ListView/><GridView/><StackView/><AdapterViewFlipper/>
  <ViewStub android:layout="@layout/stub"/>
  <android.widget.TextView />
</FrameLayout>`);
  assert.deepEqual(findDisallowedViews(source), []);
});

test('include 与 merge 放行', () => {
  const source = `<merge>\n  <include layout="@layout/widget_header" />\n  <TextView/>\n</merge>`;
  assert.deepEqual(findDisallowedViews(source), []);
  assert.deepEqual(referencedLayouts(source), ['widget_header']);
});

test('注释里的标签忽略，跨行注释不影响后续行号', () => {
  const source = xml(`<FrameLayout>
  <!-- 原来这里是 <View android:background="#000"/> -->
  <!--
    <View />
    <androidx.constraintlayout.widget.ConstraintLayout/>
  -->
  <Space />
</FrameLayout>`);
  assert.deepEqual(findDisallowedViews(source), [{ tag: 'Space', line: 8 }]);
});

test('带包名的非白名单类被标出', () => {
  const source = `<FrameLayout>
  <android.view.View />
  <androidx.constraintlayout.widget.ConstraintLayout>
    <TextView/>
  </androidx.constraintlayout.widget.ConstraintLayout>
</FrameLayout>`;
  assert.deepEqual(findDisallowedViews(source), [
    { tag: 'android.view.View', line: 2 },
    { tag: 'androidx.constraintlayout.widget.ConstraintLayout', line: 3 },
  ]);
});

test('复合按钮按 minSdk 判定', () => {
  const source = `<LinearLayout><CheckBox/><RadioButton/><Switch/></LinearLayout>`;
  assert.deepEqual(
    findDisallowedViews(source, { minSdk: 24 }).map((item) => item.tag),
    ['CheckBox', 'RadioButton', 'Switch'],
  );
  assert.deepEqual(findDisallowedViews(source, { minSdk: 31 }), []);
});

test('provider 声明里取 initialLayout 与 previewLayout', () => {
  const info = `<appwidget-provider
    android:initialLayout="@layout/widget_today"
    android:previewLayout="@layout/widget_today_preview" />`;
  assert.deepEqual(providerLayouts(info), ['widget_today', 'widget_today_preview']);
});

test('仓库内的小组件布局没有白名单外的标签', () => {
  const { infos, files, failures, missing } = checkWidgetLayouts();
  assert.ok(infos.length > 0, '应找到 widget_*_info.xml');
  assert.ok(files.length >= infos.length, '每个小组件至少一份布局');
  assert.deepEqual(missing, []);
  assert.deepEqual(failures, []);
});
