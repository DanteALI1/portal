<?php
# Generated for subdirectory deploy: https://rep.local.inion/wiki/
# Placeholders __WIKI_*__ are replaced by install-wiki.sh

if ( !defined( 'MEDIAWIKI' ) ) {
	exit;
}

$wgSitename = "__WIKI_SITENAME__";
$wgMetaNamespace = "Project";

## Protocol / path behind Nginx reverse proxy
$wgServer = "https://rep.local.inion";
$wgCanonicalServer = "https://rep.local.inion";
$wgScriptPath = "/wiki";
$wgResourceBasePath = $wgScriptPath;
$wgUsePathInfo = true;
# Keep query-string article URLs — reliable behind path-stripping proxy
$wgArticlePath = "/wiki/index.php?title=$1";

$wgScriptExtension = ".php";
$wgStylePath = "$wgResourceBasePath/skins";

## Database
$wgDBtype = "mysql";
$wgDBserver = "mariadb";
$wgDBname = "__WIKI_DB_NAME__";
$wgDBuser = "__WIKI_DB_USER__";
$wgDBpassword = "__WIKI_DB_PASSWORD__";
$wgDBprefix = "";
$wgDBTableOptions = "ENGINE=InnoDB, DEFAULT CHARSET=binary";

## Cache
$wgMainCacheType = CACHE_ACCEL;
$wgMemCachedServers = [];

## Uploads
$wgEnableUploads = true;
$wgUploadPath = "$wgScriptPath/images";
$wgUploadDirectory = "$IP/images";

## Locale
$wgLanguageCode = "ru";
$wgLocaltimezone = "Europe/Moscow";
date_default_timezone_set( $wgLocaltimezone );

## Skin
wfLoadSkin( 'Vector' );
$wgDefaultSkin = "vector-2022";

## Secrets (filled by installer)
$wgSecretKey = "__WIKI_SECRET_KEY__";
$wgAuthenticationTokenVersion = "1";
$wgUpgradeKey = "__WIKI_UPGRADE_KEY__";

## Proxy / HTTPS
$wgForceHTTPS = true;
$wgSecureLogin = true;
if ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https' ) {
	$_SERVER['HTTPS'] = 'on';
}

## Rights
$wgGroupPermissions['*']['createaccount'] = false;
$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['user']['edit'] = true;

## Misc
$wgPingback = false;
$wgJobRunRate = 1;
$wgDiff3 = "/usr/bin/diff3";
