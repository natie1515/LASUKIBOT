import fs from 'fs';
import FormData from 'form-data';
import axios from 'axios';
import path from 'path';

async function quAx(filePath) {
  try {
    const file = fs.createReadStream(filePath);
    const formData = new FormData();
    formData.append('files[]', file, path.basename(filePath));

    const response = await axios.post('https://qu.ax/upload.php', formData, {
      headers: {
        ...formData.getHeaders()
      }
    });

    if (response.data.success) {
      const fileData = response.data.files[0];
      return {
        status: true,
        creator: 'EliasarYT',
        result: {
          hash: fileData.hash,
          name: fileData.name,
          url: fileData.url,
          size: fileData.size,
          expiry: fileData.expiry
        }
      };
    } else {
      return { status: false, message: 'Error al subir el archivo' };
    }
  } catch (error) {
    return { status: false, message: error.message };
  }
}

export default quAx;
