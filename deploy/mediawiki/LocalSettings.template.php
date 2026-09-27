<?php
# Generated for subdirectory deploy: https://__DOMAIN__/wiki/
# Rendered by install-wiki.sh on every install run (placeholders __WIKI_*__ / __DOMAIN__).
# Do not edit LocalSettings.php by hand — change this template and re-run install.sh.

if ( !defined( 'MEDIAWIKI' ) ) {
	exit;
}

$wgSitename = "__WIKI_SITENAME__";
$wgMetaNamespace = "Project";

## Protocol / path behind Nginx reverse proxy (canonical name only: SSO is bound to it)
$wgServer = "https://__DOMAIN__";
$wgCanonicalServer = "https://__DOMAIN__";
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

## Secrets (kept in .env, the file is regenerated from this template)
$wgSecretKey = "__WIKI_SECRET_KEY__";
$wgAuthenticationTokenVersion = "1";
$wgUpgradeKey = "__WIKI_UPGRADE_KEY__";

## Proxy / HTTPS
$wgForceHTTPS = true;
$wgSecureLogin = true;
if ( isset( $_SERVER['HTTP_X_FORWARDED_PROTO'] ) && $_SERVER['HTTP_X_FORWARDED_PROTO'] === 'https' ) {
	$_SERVER['HTTPS'] = 'on';
}

## Single sign-on (Keycloak -> oauth2-proxy -> Nginx). Identity comes ONLY from
## X-Remote-* headers set by Nginx; Nginx overwrites/wipes them in every location.
wfLoadExtension( 'Auth_remoteuser' );

$wgAuthRemoteuserUserName = static function () {
	return $_SERVER['HTTP_X_REMOTE_USER'] ?? '';
};

# Logins from AD/Kerberos may look like user@REALM or DOMAIN\user: keep the account name.
# MediaWiki upper-cases the first letter itself (user.portal -> User.portal) and forbids
# some characters ($wgInvalidUsernameCharacters, default "@:>="), see docs/SSO.md.
$wgHooks['AuthRemoteuserFilterUserName'][] = static function ( &$username ) {
	$username = preg_replace( '/@.*$/', '', $username );
	$username = preg_replace( '/^.*\\\\/', '', $username );
	$username = trim( str_replace( [ ':', '>', '=' ], '_', $username ) );
	return $username !== '';
};

# Full name from the Keycloak access token (oauth2-proxy has no name header)
function repSsoClaims(): array {
	static $claims = null;
	if ( $claims === null ) {
		$claims = [];
		$parts = explode( '.', $_SERVER['HTTP_X_REMOTE_TOKEN'] ?? '' );
		if ( count( $parts ) === 3 ) {
			$json = base64_decode( strtr( $parts[1], '-_', '+/' ) . str_repeat( '=', ( 4 - strlen( $parts[1] ) % 4 ) % 4 ) );
			$claims = json_decode( $json ?: '[]', true ) ?: [];
		}
	}
	return $claims;
}

$wgAuthRemoteuserUserPrefsForced = [
	'realname' => static function ( $metadata ) {
		$c = repSsoClaims();
		return $c['name'] ?? trim( ( $c['given_name'] ?? '' ) . ' ' . ( $c['family_name'] ?? '' ) );
	},
	'email' => static function ( $metadata ) {
		return $_SERVER['HTTP_X_REMOTE_EMAIL'] ?? '';
	},
];

# Logout in the wiki = single logout everywhere
$wgAuthRemoteuserUserUrls = [
	'logout' => static function ( $metadata ) {
		return '/oauth2/sign_out?rd=%2F';
	},
];
$wgAuthRemoteuserAllowUserSwitch = false;
$wgAuthRemoteuserRemoveAuthPagesAndLinks = true;
$wgEmailAuthentication = false;

# Members of the wiki admin group get "sysop", everyone else loses it (synced per request)
$wgHooks['BeforeInitialize'][] = static function ( $title, $unused, $output, $user, $request, $mediaWiki ) {
	if ( !$user->isRegistered() || !isset( $_SERVER['HTTP_X_REMOTE_USER'] ) ) {
		return;
	}
	$groups = array_map( 'trim', explode( ',', $_SERVER['HTTP_X_REMOTE_GROUPS'] ?? '' ) );
	$isAdmin = in_array( '__WIKI_ADMIN_GROUP__', $groups, true );
	$ugm = \MediaWiki\MediaWikiServices::getInstance()->getUserGroupManager();
	$has = in_array( 'sysop', $ugm->getUserGroups( $user ), true );
	if ( $isAdmin && !$has ) {
		$ugm->addUserToGroup( $user, 'sysop' );
	} elseif ( !$isAdmin && $has ) {
		$ugm->removeUserFromGroup( $user, 'sysop' );
	}
};

## Rights: no anonymous access at all, accounts are created automatically on first SSO visit
$wgGroupPermissions['*']['read'] = false;
$wgGroupPermissions['*']['edit'] = false;
$wgGroupPermissions['*']['createaccount'] = false;
$wgGroupPermissions['*']['autocreateaccount'] = true;
$wgGroupPermissions['user']['read'] = true;
$wgGroupPermissions['user']['edit'] = true;

## Misc
$wgPingback = false;
$wgJobRunRate = 1;
$wgDiff3 = "/usr/bin/diff3";
