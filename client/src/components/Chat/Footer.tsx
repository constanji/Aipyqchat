import React, { useEffect } from 'react';
import TagManager from 'react-gtm-module';
import { Constants } from '@aipyq/data-provider';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function Footer({ className }: { className?: string }) {
  const { data: config } = useGetStartupConfig();
  const localize = useLocalize();

  const privacyPolicy = config?.interface?.privacyPolicy;
  const termsOfService = config?.interface?.termsOfService;

  const privacyPolicyRender = privacyPolicy?.externalUrl != null && (
    <a
      className="text-text-secondary underline"
      href={privacyPolicy.externalUrl}
      target={privacyPolicy.openNewTab === true ? '_blank' : undefined}
      rel="noreferrer"
    >
      {localize('com_ui_privacy_policy')}
    </a>
  );

  const termsOfServiceRender = termsOfService?.externalUrl != null && (
    <a
      className="text-text-secondary underline"
      href={termsOfService.externalUrl}
      target={termsOfService.openNewTab === true ? '_blank' : undefined}
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
            <span key={`text-${keyIndex++}`} className="text-text-secondary">
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
          className="text-green-500"
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
              <span className="text-text-secondary">{line}</span>
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
      typeof config?.customFooter === 'string'
        ? config.customFooter
        : 'AI 每日朋友圈  \n[浙ICP备2021031999号-3](https://beian.miit.gov.cn/)  Copyright © 2026 Powered By [aipyq.com](https://www.aipyq.com)'
    ).split('|');

    const parts = mainContentParts.map((part) => part.trim()).filter(Boolean);

    if (parts.length === 0) {
      return null;
    }

    return (
      <div className="text-text-secondary text-center">
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
              <span className="mx-1 text-text-tertiary" aria-hidden="true">
                |
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
    );
  })();

  useEffect(() => {
    if (config?.analyticsGtmId != null && typeof window.google_tag_manager === 'undefined') {
      const tagManagerArgs = {
        gtmId: config.analyticsGtmId,
      };
      TagManager.initialize(tagManagerArgs);
    }
  }, [config?.analyticsGtmId]);

  const footerElements = [mainContentRender, privacyPolicyRender, termsOfServiceRender].filter(
    Boolean,
  );

  return (
    <div className="relative w-full">
      <div
        className={
          className ??
          'absolute bottom-0 left-0 right-0 hidden items-center justify-center gap-2 px-2 py-2 text-center text-sm text-text-primary sm:flex md:px-[60px]'
        }
        role="contentinfo"
      >
        {footerElements.map((contentRender, index) => {
          const isLastElement = index === footerElements.length - 1;
          return (
            <React.Fragment key={`footer-element-${index}`}>
              {contentRender}
              {!isLastElement && (
                <div
                  key={`separator-${index}`}
                  className="h-2 border-r-[1px] border-border-medium"
                />
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
}
