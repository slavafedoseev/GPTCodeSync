import fs from 'fs';
import path from 'path';
import { Octokit } from '@octokit/core';
import clipboardy from 'clipboardy';

// Replace with your actual GitHub token and Gist ID

const GITHUB_TOKEN = 'your_github_token';
const GIST_ID = 'your_gist_id';
const GIST_USERNAME = 'your_github_username';


// Extensions that will be scanned and synced
const INCLUDED_EXTENSIONS = ['.cjs', '.js', '.json', '.md', 'LICENSE'];

// Root directory of your project
const ROOT_DIR = new URL('.', import.meta.url).pathname;

// Directories and files to be excluded
const EXCLUDED_DIRECTORIES = ['node_modules', '.git'];
const MAX_FILE_SIZE = 1048576; // 1 Megabyte

const octokit = new Octokit({ auth: GITHUB_TOKEN });

// Function to retrieve the existing files in the Gist
async function getExistingFilesInGist() {
    try {
        const response = await octokit.request('GET /gists/{gist_id}', {
            gist_id: GIST_ID
        });
        return Object.keys(response.data.files);
    } catch (error) {
        console.error('Error getting files from Gist:', error.message);
        return [];
    }
}

// Read .gitignore and add items to the excluded list
function readGitignore() {
    const gitignorePath = path.join(ROOT_DIR, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
        return [];
    }

    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    return gitignoreContent.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
}

// Merge predefined excluded items with .gitignore items
const gitignoreItems = readGitignore();
const EXCLUDED_ITEMS = [...new Set([".git", "node_modules", "launch.json", "settings.json", "package-lock.json", ".vscode", ...gitignoreItems])];

// Function to transform relative paths to filename format
function transformPathToFilename(relativePath) {
    return relativePath.split(path.sep).join('\\');
}

// Function to update or delete a single file in the Gist
async function updateSingleFileInGist(relativePath, content) {
    const filename = transformPathToFilename(relativePath);
    const files = {};
    files[filename] = { content };

    try {
        console.log(`Updating file ${filename} in Gist...`);
        const response = await octokit.request('PATCH /gists/{gist_id}', {
            gist_id: GIST_ID,
            files
        });

        console.log(`File ${filename} successfully updated`);
    } catch (error) {
        console.error(`Error updating file ${filename}:`, error.message);
        if (error.response) {
            console.error('Detailed error information:', error.response.data);
        }
    }
}

// Create the project structure excluding items in EXCLUDED_ITEMS
function createProjectStructure(directory, indent = 0) {
    let structure = '';
    const fileNames = fs.readdirSync(directory).sort();

    // First, add directories
    fileNames.filter(name => fs.statSync(path.join(directory, name)).isDirectory())
             .forEach(filename => {
                 const relativePath = path.join(directory.replace(ROOT_DIR, ''), filename);
                 if (EXCLUDED_ITEMS.includes(relativePath) || EXCLUDED_ITEMS.includes(filename)) {
                     return;
                 }

                 structure += `${' '.repeat(indent * 4)}├── ${filename}\\\n`;
                 structure += createProjectStructure(path.join(directory, filename), indent + 1);
             });

    // Then, add files
    fileNames.filter(name => fs.statSync(path.join(directory, name)).isFile())
             .forEach(filename => {
                 const relativePath = path.join(directory.replace(ROOT_DIR, ''), filename);
                 if (EXCLUDED_ITEMS.includes(relativePath) || EXCLUDED_ITEMS.includes(filename)) {
                     return;
                 }

                 structure += `${' '.repeat(indent * 4)}├── ${filename}\n`;
             });

    return structure;
}

// Retrieve file content while filtering out excluded items
function getFileContent(directory, relativePath = '') {
    let filesToProcess = [];
    const fileNames = fs.readdirSync(directory);

    fileNames.forEach(filename => {
        const filePath = path.join(directory, filename);
        const fileStat = fs.statSync(filePath);
        const relPath = path.join(relativePath, filename);

        if (EXCLUDED_ITEMS.includes(relPath) || EXCLUDED_ITEMS.includes(filename)) {
            console.log(`Excluded file/directory: ${relPath}`);
            return;
        }

        if (fileStat.isFile() && INCLUDED_EXTENSIONS.includes(path.extname(filename))) {
            if (fileStat.size > MAX_FILE_SIZE) {
                console.log(`Skipped too large file: ${relPath}`);
                return;
            }
            const content = fs.readFileSync(filePath, 'utf8').trim();
            if (content) {
                filesToProcess.push({ path: relPath, content });
            } else {
                console.log(`Skipped empty file: ${relPath}`);
            }
        } else if (fileStat.isDirectory()) {
            filesToProcess = [...filesToProcess, ...getFileContent(filePath, relPath)];
        }
    });

    return filesToProcess;
}

// Main function to sync project files with Gist
async function main() {
    console.log('Starting data collection from files...');
    const files = getFileContent(ROOT_DIR);
    console.log(`Found ${files.length} files for updating.`);

    const projectStructure = createProjectStructure(ROOT_DIR);
    if (projectStructure) {
        files.unshift({ path: '000_project_structure.txt', content: projectStructure });
    }

    // Retrieve the current files from Gist
    const existingGistFiles = await getExistingFilesInGist();

    // Create an array of files to delete by filtering out files that are in the Gist but not in the 'files' array
    // This step identifies the files that are no longer needed and should be removed from the Gist
    const filesToDelete = existingGistFiles.filter(file => 
        !files.some(f => transformPathToFilename(f.path) === file)
    );

    // Delete the identified files from Gist
    // Loop through each file in the 'filesToDelete' array and update it in the Gist with a null content, effectively removing it
    for (const file of filesToDelete) {
        await updateSingleFileInGist(file, "");
    }

    // Update the Gist with the new or modified files
    // Loop through each file in the 'files' array and update or add it to the Gist
    for (const file of files) {
        await updateSingleFileInGist(file.path, file.content);
    }

    console.log('File processing completed.');
    clipboardy.writeSync(`https://gist.github.com/${GIST_USERNAME}/${GIST_ID}`);
    console.log('Gist link copied to clipboard.');
}

main();
