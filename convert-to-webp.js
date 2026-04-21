import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

/**
 * Script to convert PNG images to WebP format.
 * Usage:
 * 1. npm install sharp
 * 2. node convert-to-webp.js
 */

const directory = 'src/assets/questions';

async function convert() {
  if (!fs.existsSync(directory)) {
    console.error(`Directory not found: ${directory}`);
    return;
  }

  const files = fs.readdirSync(directory);
  const pngFiles = files.filter(file => file.toLowerCase().endsWith('.png'));

  if (pngFiles.length === 0) {
    console.log('No PNG files found in the directory.');
    return;
  }

  console.log(`Found ${pngFiles.length} PNG files. Starting conversion...`);

  for (const file of pngFiles) {
    const inputPath = path.join(directory, file);
    const outputPath = path.join(directory, file.replace(/\.png$/i, '.webp'));
    
    try {
      console.log(`Converting: ${file} -> ${path.basename(outputPath)}`);
      await sharp(inputPath)
        .webp({ quality: 85 })
        .toFile(outputPath);
    } catch (error) {
      console.error(`Failed to convert ${file}:`, error.message);
    }
  }

  console.log('\nMigration complete! You can now safely remove the .png files.');
}

convert();
