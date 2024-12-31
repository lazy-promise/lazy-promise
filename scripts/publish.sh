# REPO_VERSION will be {} if there is no version field in package.json.
REPO_VERSION=$(pnpm pkg get version | sed 's/"//g')
if [ $REPO_VERSION = "{}" ]
  then
    exit 0
fi
# PUBLISHED_VERSION will be blank if the package is not published yet (404).
PUBLISHED_VERSION=$(pnpm view "$PNPM_PACKAGE_NAME" version 2>/dev/null || echo "")
if [ $REPO_VERSION != "$PUBLISHED_VERSION" ]
  then
    # Because some workspace:* dependencies point to unpublished packages.
    pnpm pkg delete devDependencies
    pnpm publish --access=public --no-git-checks || exit 1
    git tag $PNPM_PACKAGE_NAME@$REPO_VERSION
fi
