import { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import throttle from 'lodash/throttle';
import { useRecoilValue } from 'recoil';
import { getConfigDefaults } from "@aipyq/data-provider";
import {
  ResizableHandleAlt,
  ResizablePanel,
  ResizablePanelGroup,
  useMediaQuery,
} from "@aipyq/client";
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { useGetStartupConfig } from '~/data-provider';
import { normalizeLayout, cn } from '~/utils';
import SidePanel from './SidePanel';
import ThoughtChainView from './ThoughtChain/ThoughtChainView';
import NavToggle from '~/components/Nav/NavToggle';
import store from '~/store';

interface SidePanelProps {
  defaultLayout?: number[] | undefined;
  defaultCollapsed?: boolean;
  navCollapsedSize?: number;
  fullPanelCollapse?: boolean;
  artifacts?: React.ReactNode;
  children: React.ReactNode;
}

const defaultMinSize = 20;
const defaultInterface = getConfigDefaults().interface;

const SidePanelGroup = memo(
  ({
    defaultLayout = [97, 3],
    defaultCollapsed = false,
    fullPanelCollapse = false,
    navCollapsedSize = 3,
    artifacts,
    children,
  }: SidePanelProps) => {
    const { data: startupConfig } = useGetStartupConfig();
    const interfaceConfig = useMemo(
      () => startupConfig?.interface ?? defaultInterface,
      [startupConfig],
    );

    const panelRef = useRef<ImperativePanelHandle>(null);
    const thoughtChainPanelRef = useRef<ImperativePanelHandle>(null);
    const [minSize, setMinSize] = useState(defaultMinSize);
    const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);
    const [fullCollapse, setFullCollapse] = useState(fullPanelCollapse);
    const [collapsedSize, setCollapsedSize] = useState(navCollapsedSize);
    // 思维链初始即为收起状态，minSize 为 0，避免一开始预留宽度
    const [thoughtChainCollapsed, setThoughtChainCollapsed] = useState(true);
    const [thoughtChainMinSize, setThoughtChainMinSize] = useState(0);

    const isSmallScreen = useMediaQuery('(max-width: 767px)');
    const hideSidePanel = useRecoilValue(store.hideSidePanel);

    const calculateLayout = useCallback(() => {
      // 如果有 artifacts，布局为 [main, artifacts, thoughtChain]
      // 如果没有 artifacts，布局为 [main, thoughtChain]
      if (artifacts != null) {
        const thoughtChainSize = thoughtChainCollapsed ? 0 : 25;
        const remainingSpace = 100 - thoughtChainSize;
        const newMainSize = Math.floor(remainingSpace / 2);
        const artifactsSize = remainingSpace - newMainSize;
        return [newMainSize, artifactsSize, thoughtChainSize];
      } else {
        const thoughtChainSize = thoughtChainCollapsed ? 0 : 25;
        return [100 - thoughtChainSize, thoughtChainSize];
      }
    }, [artifacts, thoughtChainCollapsed]);

    const currentLayout = useMemo(() => normalizeLayout(calculateLayout()), [calculateLayout]);

    const throttledSaveLayout = useMemo(
      () =>
        throttle((sizes: number[]) => {
          const normalizedSizes = normalizeLayout(sizes);
          localStorage.setItem('react-resizable-panels:layout', JSON.stringify(normalizedSizes));
        }, 350),
      [],
    );

    useEffect(() => {
      if (isSmallScreen) {
        setIsCollapsed(true);
        setCollapsedSize(0);
        setMinSize(defaultMinSize);
        setFullCollapse(true);
        // 小屏下默认收起思维链
        setThoughtChainCollapsed(true);
        setThoughtChainMinSize(0);
        localStorage.setItem('fullPanelCollapse', 'true');
        panelRef.current?.collapse();
        thoughtChainPanelRef.current?.collapse();
        return;
      } else {
        setIsCollapsed(defaultCollapsed);
        setCollapsedSize(navCollapsedSize);
        setMinSize(defaultMinSize);
        // 大屏下也默认收起思维链（忽略历史状态），并实际折叠面板
        setThoughtChainCollapsed(true);
        setThoughtChainMinSize(0);
        localStorage.setItem('thoughtChainCollapsed', 'true');
        thoughtChainPanelRef.current?.collapse();
      }
    }, [isSmallScreen, defaultCollapsed, navCollapsedSize, fullPanelCollapse]);

    const minSizeMain = useMemo(() => (artifacts != null ? 15 : 30), [artifacts]);

    /** Memoized close button handler to prevent re-creating it */
    const handleClosePanel = useCallback(() => {
      setIsCollapsed(() => {
        localStorage.setItem('fullPanelCollapse', 'true');
        setFullCollapse(true);
        setCollapsedSize(0);
        setMinSize(0);
        return false;
      });
      panelRef.current?.collapse();
    }, []);

    // 思维链侧边栏的打开/关闭切换（类似原始右侧边栏 NavToggle 行为）
    const [isThoughtChainHovering, setIsThoughtChainHovering] = useState(false);

    const toggleThoughtChainVisible = useCallback(() => {
      setThoughtChainCollapsed((prev) => {
        const next = !prev;
        setThoughtChainMinSize(next ? 0 : 20);
        localStorage.setItem('thoughtChainCollapsed', next ? 'true' : 'false');

        if (next) {
          // 折叠
          thoughtChainPanelRef.current?.collapse();
        } else {
          // 展开
          thoughtChainPanelRef.current?.expand();
        }

        return next;
      });
    }, []);

    return (
      <>
        <ResizablePanelGroup
          direction="horizontal"
          onLayout={(sizes) => throttledSaveLayout(sizes)}
          className="transition-width relative h-full w-full flex-1 overflow-auto bg-presentation"
        >
          <ResizablePanel
            defaultSize={currentLayout[0]}
            minSize={minSizeMain}
            order={1}
            id="messages-view"
          >
            {children}
          </ResizablePanel>
          {artifacts != null && (
            <>
              <ResizableHandleAlt withHandle className="ml-3 bg-border-medium text-text-primary" />
              <ResizablePanel
                defaultSize={currentLayout[1]}
                minSize={minSizeMain}
                order={2}
                id="artifacts-panel"
              >
                {artifacts}
              </ResizablePanel>
            </>
          )}

          {/* 思考链面板 - 显示在右侧（去掉拖动，只保留开关按钮） */}
          {!isSmallScreen && (
            <>
              {/* 跟随思维链左侧的打开/关闭按钮（模仿原右侧边栏 NavToggle 行为） */}
              <div
                onMouseEnter={() => setIsThoughtChainHovering(true)}
                onMouseLeave={() => setIsThoughtChainHovering(false)}
                className="relative flex w-px items-center justify-center"
              >
                <NavToggle
                  navVisible={!thoughtChainCollapsed}
                  isHovering={isThoughtChainHovering}
                  onToggle={toggleThoughtChainVisible}
                  setIsHovering={setIsThoughtChainHovering}
                  className="fixed top-1/2 mr-2"
                  translateX={false}
                  side="right"
                />
              </div>
              <ResizablePanel
                ref={thoughtChainPanelRef}
                defaultSize={currentLayout[currentLayout.length - 1]}
                minSize={thoughtChainMinSize}
                maxSize={50}
                collapsible={true}
                collapsedSize={0}
                order={artifacts != null ? 3 : 2}
                id="thought-chain-panel"
                onCollapse={() => {
                  setThoughtChainCollapsed(true);
                  setThoughtChainMinSize(0);
                  localStorage.setItem('thoughtChainCollapsed', 'true');
                }}
                onExpand={() => {
                  setThoughtChainCollapsed(false);
                  setThoughtChainMinSize(20);
                  localStorage.setItem('thoughtChainCollapsed', 'false');
                }}
                className={cn(
                  'border-l border-border-light bg-background transition-opacity',
                  thoughtChainCollapsed ? 'min-w-0 opacity-0' : 'min-w-[340px] sm:min-w-[352px] opacity-100',
                )}
                style={{
                  overflowY: 'auto',
                  transition: 'width 0.2s ease, visibility 0s linear 0.2s',
                }}
              >
                <ThoughtChainView />
              </ResizablePanel>
            </>
          )}

          {/* 侧边栏已完全移除，所有功能已迁移到独立页面 */}
          {false && !hideSidePanel && interfaceConfig.sidePanel === true && (
            <SidePanel
              panelRef={panelRef}
              minSize={minSize}
              setMinSize={setMinSize}
              isCollapsed={isCollapsed}
              setIsCollapsed={setIsCollapsed}
              collapsedSize={collapsedSize}
              setCollapsedSize={setCollapsedSize}
              fullCollapse={fullCollapse}
              setFullCollapse={setFullCollapse}
              defaultSize={currentLayout[currentLayout.length - 1]}
              hasArtifacts={artifacts != null}
              interfaceConfig={interfaceConfig}
            />
          )}
        </ResizablePanelGroup>
        {/* 侧边栏已完全移除，关闭按钮也已隐藏 */}
        {false && (
        <button
          aria-label="Close right side panel"
          className={`nav-mask ${!isCollapsed ? 'active' : ''}`}
          onClick={handleClosePanel}
        />
        )}
      </>
    );
  },
);

SidePanelGroup.displayName = 'SidePanelGroup';

export default SidePanelGroup;
