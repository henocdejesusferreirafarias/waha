import * as fs from 'node:fs';
import * as path from 'node:path';

interface PackageMetadata {
  name: string;
  version: string;
}

function loadPackageMetadata(packageName: string): PackageMetadata {
  let directory = path.dirname(require.resolve(packageName));

  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const metadata = JSON.parse(
        fs.readFileSync(manifestPath, 'utf8'),
      ) as PackageMetadata;
      if (metadata.name === packageName) {
        return metadata;
      }
    }
    directory = path.dirname(directory);
  }

  throw new Error(`Package metadata not found for ${packageName}`);
}

function isVersionAtLeast(actual: string, minimum: string): boolean {
  const actualParts = actual.split('.').map(Number);
  const minimumParts = minimum.split('.').map(Number);

  for (let index = 0; index < minimumParts.length; index += 1) {
    if (actualParts[index] > minimumParts[index]) {
      return true;
    }
    if (actualParts[index] < minimumParts[index]) {
      return false;
    }
  }

  return true;
}

describe('WPP dependency compatibility', () => {
  it('uses a WPPConnect release containing the MsgStore compatibility fix', () => {
    const wppconnectPackage = loadPackageMetadata(
      '@wppconnect-team/wppconnect',
    );
    expect(isVersionAtLeast(wppconnectPackage.version, '2.2.5')).toBe(true);
  });

  it('uses a WA-JS release containing the MsgStore compatibility fix', () => {
    const waJsPackage = loadPackageMetadata('@wppconnect/wa-js');
    expect(isVersionAtLeast(waJsPackage.version, '4.4.3')).toBe(true);
  });
});
