import React from 'react';
import { useLocalize } from '~/hooks';
import { TStartupConfig } from '@aipyq/data-provider';

function Footer({ startupConfig }: { startupConfig: TStartupConfig | null | undefined }) {
  const localize = useLocalize();
  if (!startupConfig) {
    return null;
  }
  const privacyPolicy = startupConfig.interface?.privacyPolicy;
  const termsOfService = startupConfig.interface?.termsOfService;

  const privacyPolicyRender = privacyPolicy?.externalUrl && (
    <a
      className="text-xs text-green-500"
      href={privacyPolicy.externalUrl}
      target={privacyPolicy.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_privacy_policy')}
    </a>
  );

  const termsOfServiceRender = termsOfService?.externalUrl && (
    <a
      className="text-xs text-green-500"
      href={termsOfService.externalUrl}
      target={termsOfService.openNewTab ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_terms_of_service')}
    </a>
  );

  // 解析 Markdown 链接格式 [text](url) 并转换为 JSX，同时处理换行符
  const parseMarkdownLinks = (text: string) => {
    const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;
    let keyIndex = 0;

    // 处理文本中的换行符和链接
    const processTextSegment = (segment: string) => {
      if (!segment) return;
      
      // 按换行符分割
      const lines = segment.split('\n');
      lines.forEach((line, lineIndex) => {
        if (line) {
          parts.push(
            <span key={`text-${keyIndex++}`} className="text-sm text-gray-600 dark:text-gray-400">
              {line}
            </span>
          );
        }
        // 在每行后添加换行（除了最后一行）
        if (lineIndex < lines.length - 1) {
          parts.push(<br key={`br-${keyIndex++}`} />);
        }
      });
    };

    while ((match = linkRegex.exec(text)) !== null) {
      // 添加链接前的文本（处理换行）
      if (match.index > lastIndex) {
        const beforeText = text.substring(lastIndex, match.index);
        processTextSegment(beforeText);
      }

      // 添加链接
      const linkText = match[1];
      const linkUrl = match[2];
      parts.push(
        <a
          key={`link-${keyIndex++}`}
          href={linkUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-green-500"
        >
          {linkText}
        </a>
      );

      lastIndex = linkRegex.lastIndex;
    }

    // 添加剩余的文本（处理换行）
    if (lastIndex < text.length) {
      const remainingText = text.substring(lastIndex);
      processTextSegment(remainingText);
    }

    // 如果没有找到链接，处理换行并返回
    if (parts.length === 0) {
      const lines = text.split('\n');
      return (
        <>
          {lines.map((line, index) => (
            <React.Fragment key={`line-${index}`}>
              <span className="text-sm text-gray-600 dark:text-gray-400">{line}</span>
              {index < lines.length - 1 && <br />}
            </React.Fragment>
          ))}
        </>
      );
    }

    return parts;
  };

  // 主内容：解析 Markdown 链接并渲染
  const mainContentRender = (() => {
    const mainContentParts = (
      typeof startupConfig?.customFooter === 'string'
        ? startupConfig.customFooter
        : 'AI 每日朋友圈  \n[浙ICP备2021031999号-3](https://beian.miit.gov.cn/)  Copyright © 2026 Powered By [aipyq.com](https://www.aipyq.com)'
    ).split('|');

    const parts = mainContentParts.map((part) => part.trim()).filter(Boolean);

    if (parts.length === 0) {
      return null;
    }

    return (
      <div className="text-sm text-gray-600 dark:text-gray-400 text-center">
        {parts.map((part, index) => (
          <React.Fragment key={`custom-footer-part-${index}`}>
            {index === 0 && (
              <img
                src="/assets/logo.svg"
                alt="Logo"
                className="inline-block h-3.5 w-3.5 mr-1 align-middle relative top-[-1px]"
              />
            )}
            {parseMarkdownLinks(part)}
            {index < parts.length - 1 && (
              <span className="mx-1 text-gray-400 dark:text-gray-500" aria-hidden="true">
                |
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  })();

  const footerElements = [mainContentRender, privacyPolicyRender, termsOfServiceRender].filter(
    Boolean,
  );

  return (
    <div className="align-end m-4 flex flex-wrap items-center justify-center gap-2" role="contentinfo">
      {footerElements.map((contentRender, index) => {
        const isLastElement = index === footerElements.length - 1;
        return (
          <React.Fragment key={`footer-element-${index}`}>
            {contentRender}
            {!isLastElement && (
              <div
                key={`separator-${index}`}
                className="h-2 border-r-[1px] border-gray-300 dark:border-gray-600"
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export default Footer;
