<?php

declare(strict_types=1);

/**
 * Dump project source files into a single text file.
 *
 * Usage:
 *   php tools/dump_code.php [output_file] [source_dir] [modules_csv]
 *
 * Examples:
 *   php tools/dump_code.php dump.txt .
 *   php tools/dump_code.php artifacts/code_dump.txt c:\path\to\project
 *   php tools/dump_code.php artifacts/modules_dump.txt . "desktop/src,local-api/src,automation"
 */

const DEFAULT_OUTPUT = 'code_dump.txt';
const MAX_FILE_SIZE_BYTES = 1024 * 1024 * 2; // 2 MB per file

$outputFile = $argv[1] ?? DEFAULT_OUTPUT;
$sourceDir = $argv[2] ?? '.';
$modulesCsv = $argv[3] ?? '';

$sourceReal = realpath($sourceDir);
if ($sourceReal === false || !is_dir($sourceReal)) {
    fwrite(STDERR, "Source directory not found: {$sourceDir}" . PHP_EOL);
    exit(1);
}

$outputPath = $outputFile;
if (!preg_match('/^[A-Za-z]:\\\\|^\//', $outputFile)) {
    $outputPath = $sourceReal . DIRECTORY_SEPARATOR . $outputFile;
}

$excludeDirs = [
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.next',
    '.cache',
    '.idea',
    '.vscode',
    'automation/output',
    'automation/state',
];

$excludeFiles = [
    basename($outputPath),
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
];

$includeExtensions = [
    'php', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'json',
    'css', 'scss', 'sass', 'less', 'html', 'xml',
    'yml', 'yaml', 'ini', 'env', 'py', 'go', 'rs', 'java',
    'kt', 'swift', 'rb', 'sql', 'sh', 'bat', 'ps1',
    'toml', 'c', 'h', 'cpp', 'hpp',
];

$defaultModules = [
    'desktop/src',
    'desktop/electron',
    'local-api/src',
    'automation',
    'tools',
];

$modules = [];
if (trim($modulesCsv) !== '') {
    foreach (explode(',', $modulesCsv) as $module) {
        $normalized = trim(str_replace('\\', '/', $module));
        if ($normalized !== '') {
            $modules[] = trim($normalized, '/');
        }
    }
} else {
    $modules = $defaultModules;
}

$header = [
    "Code dump generated at: " . date(DATE_ATOM),
    "Source directory: {$sourceReal}",
    "Modules: " . implode(', ', $modules),
    str_repeat('=', 90),
    '',
];

if (!is_dir(dirname($outputPath))) {
    if (!mkdir(dirname($outputPath), 0777, true) && !is_dir(dirname($outputPath))) {
        fwrite(STDERR, "Cannot create output directory: " . dirname($outputPath) . PHP_EOL);
        exit(1);
    }
}

if (file_put_contents($outputPath, implode(PHP_EOL, $header)) === false) {
    fwrite(STDERR, "Cannot write output file: {$outputPath}" . PHP_EOL);
    exit(1);
}

$it = new RecursiveIteratorIterator(
    new RecursiveDirectoryIterator(
        $sourceReal,
        FilesystemIterator::SKIP_DOTS | FilesystemIterator::CURRENT_AS_FILEINFO
    )
);

$includedCount = 0;
$skippedCount = 0;

foreach ($it as $fileInfo) {
    /** @var SplFileInfo $fileInfo */
    $fullPath = $fileInfo->getPathname();
    $relativePath = ltrim(str_replace($sourceReal, '', $fullPath), DIRECTORY_SEPARATOR);
    $relativeUnix = str_replace('\\', '/', $relativePath);

    if (shouldSkipPath($relativeUnix, $excludeDirs)) {
        $skippedCount++;
        continue;
    }

    if (!isInModules($relativeUnix, $modules)) {
        $skippedCount++;
        continue;
    }

    if ($fileInfo->isDir()) {
        continue;
    }

    if (in_array($fileInfo->getBasename(), $excludeFiles, true)) {
        $skippedCount++;
        continue;
    }

    if ($fullPath === $outputPath) {
        $skippedCount++;
        continue;
    }

    $ext = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));
    if (!in_array($ext, $includeExtensions, true)) {
        $skippedCount++;
        continue;
    }

    $size = $fileInfo->getSize();
    if ($size === false || $size > MAX_FILE_SIZE_BYTES) {
        $skippedCount++;
        continue;
    }

    $content = @file_get_contents($fullPath);
    if ($content === false) {
        $skippedCount++;
        continue;
    }

    if (looksBinary($content)) {
        $skippedCount++;
        continue;
    }

    $block = [];
    $block[] = str_repeat('-', 90);
    $block[] = "FILE: {$relativeUnix}";
    $block[] = str_repeat('-', 90);
    $block[] = $content;
    $block[] = '';

    if (file_put_contents($outputPath, implode(PHP_EOL, $block), FILE_APPEND) === false) {
        fwrite(STDERR, "Failed while appending file: {$relativeUnix}" . PHP_EOL);
        exit(1);
    }

    $includedCount++;
}

$summary = [
    '',
    str_repeat('=', 90),
    "Done. Included files: {$includedCount}; skipped files: {$skippedCount}",
    "Output file: {$outputPath}",
    '',
];

file_put_contents($outputPath, implode(PHP_EOL, $summary), FILE_APPEND);

echo "Dump completed: {$outputPath}" . PHP_EOL;
echo "Included: {$includedCount}; skipped: {$skippedCount}" . PHP_EOL;

/**
 * @param string[] $excludeDirs
 */
function shouldSkipPath(string $relativePath, array $excludeDirs): bool
{
    foreach ($excludeDirs as $dir) {
        $dir = trim(str_replace('\\', '/', $dir), '/');
        if ($dir === '') {
            continue;
        }
        if ($relativePath === $dir || str_starts_with($relativePath, $dir . '/')) {
            return true;
        }
    }
    return false;
}

/**
 * @param string[] $modules
 */
function isInModules(string $relativePath, array $modules): bool
{
    foreach ($modules as $module) {
        $module = trim(str_replace('\\', '/', $module), '/');
        if ($module === '') {
            continue;
        }
        if ($relativePath === $module || str_starts_with($relativePath, $module . '/')) {
            return true;
        }
    }
    return false;
}

function looksBinary(string $content): bool
{
    $sample = substr($content, 0, 4096);
    return preg_match('/[\x00-\x08\x0E-\x1F]/', $sample) === 1;
}

