const FS = require('fs');
const Errors = require('../exceptions/errors');
const MinioUtils = require('./minio');
const Archiver = require('archiver');
const EntitiesUtils = require('./entities');
const Utils = require('./utils');
const Logger = require('../../logger');


async function add_single(ctx) {
    const file = ctx.request.file;
    console.log(file);
    await MinioUtils.create_bucket_if_needed(MinioUtils.default_bucket);
    await MinioUtils.put_into_bucket(MinioUtils.default_bucket, file);

    try {
        FS.unlinkSync(file.path);
    } catch (errfs) {}
    ctx.body = { file: file.filename };
}

async function download(ctx) {
    const entity = ctx.params.entity.trim();
    const eid = ctx.params.eid.trim();
    const filename = ctx.params.filename.trim();

    if (entity === '' || eid === '' || filename === '') {
        throw Errors.DownloadDoesNotExist;
    }

    const information = await EntitiesUtils.retrieve_and_get_source(entity, eid);
    if (!information) {
        throw Errors.DownloadDoesNotExist;
    }

    const files = Utils.find_value_with_path(information, 'files'.split('.'));

    if (!files) {
        throw Errors.DownloadDoesNotExist;
    }

    const file = files.find(f => f.url === filename);

    if (!file) {
        Logger.error(`Unable to find file with URI: ${filename}`);
        throw Errors.DownloadDoesNotExist;
    }


    const stream = await MinioUtils.retrieve_file(MinioUtils.default_bucket, filename);
    ctx.set('Content-disposition', `attachment; filename=${file.name}`);
    ctx.statusCode = 200;
    ctx.body = stream;
}

async function multi_download(ctx) {
    const body = ctx.params;
    const entity = body.entity || '';
    const eid = body.eid || '';
    const names = body.names ? body.names.split('|') : [];
    const filenames = body.filenames ? body.filenames.split('|') : [];


    if (entity === '' || eid === ''
        || filenames.length === 0 || names.length === 0
        || names.length !== filenames.length) {
        throw Errors.DownloadDoesNotExist;
    }

    const information = await EntitiesUtils.retrieve_and_get_source(entity, eid);
    if (!information) {
        throw Errors.DownloadDoesNotExist;
    }

    const archive = Archiver('zip', {
        zlib: { level: 1 }, // Sets the compression level.
    });

    for (const i in filenames) {
        const filename = filenames[i];
        const name = names[i];
        const stream = await MinioUtils.retrieve_file(MinioUtils.default_bucket, filename);
        archive.append(stream, { name });
    }

    ctx.set('Content-disposition', 'attachment; filename=pos_download.zip');
    ctx.statusCode = 200;
    ctx.body = archive;
    archive.finalize();
}

module.exports = {
    add_single,
    download,
    multi_download,
};
