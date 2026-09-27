# MediaWiki with single sign-on (Auth_remoteuser, identity from Nginx headers)
FROM docker.io/mediawiki:1.41.5

# Extension is vendored in the repo (see extensions/Auth_remoteuser/VERSION):
# the image builds without internet access and the version is pinned.
COPY extensions/Auth_remoteuser /var/www/html/extensions/Auth_remoteuser
