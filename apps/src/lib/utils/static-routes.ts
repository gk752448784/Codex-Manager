"use client";

export function normalizeRoutePath(path: string): string {
  if (!path || path === "/") {
    return "/";
  }
  return path.replace(/\/+$/, "");
}

function looksLikeAssetPath(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() || "";
  return lastSegment.includes(".");
}

export function buildStaticRouteUrl(
  pathname: string,
  search = "",
  hash = "",
): string {
  if (!pathname || pathname === "/") {
    return `/${search}${hash}`;
  }

  if (pathname.endsWith("/") || looksLikeAssetPath(pathname)) {
    return `${pathname}${search}${hash}`;
  }

  return `${pathname}/${search}${hash}`;
}

export function getCanonicalStaticRouteUrl(): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const { pathname, search, hash } = window.location;
  const canonical = buildStaticRouteUrl(pathname, search, hash);
  const current = `${pathname}${search}${hash}`;
  return canonical === current ? null : canonical;
}
